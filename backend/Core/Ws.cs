using System.Buffers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Oma.Core;

public static class Ws
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static Task SendText(this WebSocket socket, string text, CancellationToken ct) =>
        socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, ct);

    public static Task SendJson(this WebSocket socket, object payload, CancellationToken ct) =>
        socket.SendText(JsonSerializer.Serialize(payload, Json), ct);

    /// <summary>
    /// Runs <paramref name="producer"/> until the client goes away, feeding whole
    /// incoming messages to <paramref name="onMessage"/>.
    /// </summary>
    public static async Task Serve(
        HttpContext context,
        Func<WebSocket, CancellationToken, Task> producer,
        Func<WebSocketMessageType, ReadOnlyMemory<byte>, Task>? onMessage = null)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsync("Expected a WebSocket request.");
            return;
        }

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);

        var receiving = Receive(socket, onMessage, cts.Token);
        var producing = producer(socket, cts.Token);
        try
        {
            await Task.WhenAny(receiving, producing);
        }
        finally
        {
            cts.Cancel();
            try { await Task.WhenAll(receiving, producing); }
            catch (Exception ex) when (ex is OperationCanceledException or WebSocketException or IOException) { }
        }

        if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
            try
            {
                using var closing = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, closing.Token);
            }
            catch (Exception ex) when (ex is OperationCanceledException or WebSocketException or IOException) { }
        }
    }

    private static async Task Receive(
        WebSocket socket, Func<WebSocketMessageType, ReadOnlyMemory<byte>, Task>? onMessage, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        var message = new ArrayBufferWriter<byte>();
        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(buffer.AsMemory(), ct);
            if (result.MessageType == WebSocketMessageType.Close) return;

            message.Write(buffer.AsSpan(0, result.Count));
            if (!result.EndOfMessage) continue;

            if (onMessage is not null) await onMessage(result.MessageType, message.WrittenMemory);
            message.Clear();
        }
    }
}
