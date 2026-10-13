using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;
using Oma.Core;

namespace Oma.Features;

/// <summary>
/// Binary frames carry terminal bytes in both directions; text frames are JSON
/// control messages from the client ({"type":"resize","cols":80,"rows":24}).
/// </summary>
public static class TerminalFeature
{
    public static void MapTerminal(this WebApplication app)
    {
        app.Map("/ws/terminal", async (HttpContext context, ILoggerFactory loggers) =>
        {
            var log = loggers.CreateLogger("Terminal");
            var query = context.Request.Query;
            var cols = int.TryParse(query["cols"], out var c) ? c : 80;
            var rows = int.TryParse(query["rows"], out var r) ? r : 24;
            var tmux = query["tmux"] == "1" && Sh.Has("tmux");

            var shell = Environment.GetEnvironmentVariable("SHELL") is { Length: > 0 } s && File.Exists(s) ? s : "/bin/bash";
            Pty? pty = null;

            await Ws.Serve(context,
                async (socket, ct) =>
                {
                    try
                    {
                        // tmux keeps the session alive across reconnects; a plain shell dies with the socket
                        pty = tmux
                            ? Pty.Start("tmux", ["new-session", "-A", "-s", "oma"], cols, rows)
                            : Pty.Start(shell, ["-l"], cols, rows);
                    }
                    catch (IOException ex)
                    {
                        log.LogError("pty: {Message}", ex.Message);
                        await socket.SendAsync("\r\n[oma] não foi possível abrir o terminal\r\n"u8.ToArray(), WebSocketMessageType.Binary, true, ct);
                        return;
                    }

                    var output = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(256) { SingleReader = true, SingleWriter = true });
                    var reader = Task.Factory.StartNew(() =>
                    {
                        var buffer = new byte[32 * 1024];
                        int read;
                        while ((read = pty.Read(buffer)) > 0)
                        {
                            if (!output.Writer.WriteAsync(buffer.AsSpan(0, read).ToArray(), ct).AsTask().Wait(Timeout.Infinite, CancellationToken.None)) break;
                        }

                        output.Writer.TryComplete();
                    }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);

                    try
                    {
                        await foreach (var chunk in output.Reader.ReadAllAsync(ct))
                        {
                            await socket.SendAsync(chunk, WebSocketMessageType.Binary, true, ct);
                        }
                    }
                    finally
                    {
                        pty.Dispose();
                        try { await reader; } catch (Exception ex) when (ex is AggregateException or OperationCanceledException) { }
                    }
                },
                (type, data) =>
                {
                    if (pty is null) return Task.CompletedTask;
                    if (type == WebSocketMessageType.Binary)
                    {
                        pty.Write(data.Span);
                        return Task.CompletedTask;
                    }

                    using var doc = JsonX.TryParse(System.Text.Encoding.UTF8.GetString(data.Span));
                    if (doc?.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.Str("type") == "resize")
                        pty.Resize(doc.RootElement.Int("cols", 80), doc.RootElement.Int("rows", 24));
                    return Task.CompletedTask;
                });
        });
    }
}
