using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using Oma.App.Application.Abstractions.Terminal;

namespace Oma.App.Infrastructure.Terminal;

public sealed class TerminalSessionGateway : ITerminalSessionGateway
{
    private const int BufferSize = 4 * 1024;

    public async Task HandleAsync(WebSocket webSocket, CancellationToken cancellationToken)
    {
        using var shellProcess = CreateShellProcess();
        shellProcess.Start();

        var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var linkedToken = linkedCts.Token;
        var sendLock = new SemaphoreSlim(1, 1);

        var stdoutTask = PumpOutputToWebSocketAsync(shellProcess.StandardOutput, webSocket, sendLock, linkedToken);
        var stderrTask = PumpOutputToWebSocketAsync(shellProcess.StandardError, webSocket, sendLock, linkedToken);
        var monitorTask = MonitorShellExitAsync(shellProcess, webSocket, sendLock, linkedToken);

        try
        {
            await ReceiveInputFromWebSocketAsync(webSocket, shellProcess, linkedToken);
        }
        finally
        {
            linkedCts.Cancel();

            await ShutdownShellAsync(shellProcess);

            await Task.WhenAll(
                IgnoreCancellationAsync(stdoutTask),
                IgnoreCancellationAsync(stderrTask),
                IgnoreCancellationAsync(monitorTask));

            if (webSocket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Terminal socket closed.", CancellationToken.None);
            }

            sendLock.Dispose();
            linkedCts.Dispose();
        }
    }

    private static Process CreateShellProcess()
    {
        var userHome = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var shellPath = "/bin/bash";
        var scriptPath = "/usr/bin/script";

        var startInfo = new ProcessStartInfo
        {
            WorkingDirectory = string.IsNullOrWhiteSpace(userHome) ? "/" : userHome,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        startInfo.Environment["TERM"] = "xterm-256color";
        startInfo.Environment["COLORTERM"] = "truecolor";

        if (File.Exists(scriptPath))
        {
            // script(1) allocates a pseudo-terminal, allowing full-screen/TUI apps to work.
            startInfo.FileName = scriptPath;
            startInfo.Arguments = $"-qf -c \"{shellPath} -i\" /dev/null";
        }
        else
        {
            // Fallback if script is missing.
            startInfo.FileName = shellPath;
            startInfo.Arguments = "--noprofile --norc -i";
        }

        return new Process
        {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };
    }

    private static async Task ReceiveInputFromWebSocketAsync(
        WebSocket webSocket,
        Process shellProcess,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[BufferSize];

        while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var ms = new MemoryStream();
            WebSocketReceiveResult receiveResult;

            do
            {
                receiveResult = await webSocket.ReceiveAsync(buffer, cancellationToken);

                if (receiveResult.MessageType == WebSocketMessageType.Close)
                {
                    return;
                }

                ms.Write(buffer, 0, receiveResult.Count);
            }
            while (!receiveResult.EndOfMessage);

            if (receiveResult.MessageType != WebSocketMessageType.Text)
            {
                continue;
            }

            if (shellProcess.HasExited)
            {
                return;
            }

            var input = Encoding.UTF8.GetString(ms.ToArray());
            await shellProcess.StandardInput.WriteAsync(input);
            await shellProcess.StandardInput.FlushAsync();
        }
    }

    private static async Task PumpOutputToWebSocketAsync(
        StreamReader reader,
        WebSocket webSocket,
        SemaphoreSlim sendLock,
        CancellationToken cancellationToken)
    {
        var charBuffer = new char[BufferSize];

        while (!cancellationToken.IsCancellationRequested)
        {
            var read = await reader.ReadAsync(charBuffer, 0, charBuffer.Length);
            if (read <= 0)
            {
                return;
            }

            var text = new string(charBuffer, 0, read);
            await SendTextAsync(webSocket, sendLock, text, cancellationToken);
        }
    }

    private static async Task MonitorShellExitAsync(
        Process shellProcess,
        WebSocket webSocket,
        SemaphoreSlim sendLock,
        CancellationToken cancellationToken)
    {
        try
        {
            await shellProcess.WaitForExitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        if (cancellationToken.IsCancellationRequested)
        {
            return;
        }

        await SendTextAsync(webSocket, sendLock,
            $"\r\n[shell exited with code {shellProcess.ExitCode}]\r\n",
            CancellationToken.None);

        if (webSocket.State == WebSocketState.Open)
        {
            await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Shell process exited.", CancellationToken.None);
        }
    }

    private static async Task SendTextAsync(
        WebSocket webSocket,
        SemaphoreSlim sendLock,
        string text,
        CancellationToken cancellationToken)
    {
        if (webSocket.State != WebSocketState.Open)
        {
            return;
        }

        var payload = Encoding.UTF8.GetBytes(text);

        await sendLock.WaitAsync(cancellationToken);
        try
        {
            if (webSocket.State == WebSocketState.Open)
            {
                await webSocket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
            }
        }
        finally
        {
            sendLock.Release();
        }
    }

    private static async Task ShutdownShellAsync(Process shellProcess)
    {
        try
        {
            if (shellProcess.HasExited)
            {
                return;
            }

            await shellProcess.StandardInput.WriteAsync("exit\n");
            await shellProcess.StandardInput.FlushAsync();

            var exited = shellProcess.WaitForExit(800);
            if (!exited && !shellProcess.HasExited)
            {
                shellProcess.Kill(true);
            }
        }
        catch
        {
            if (!shellProcess.HasExited)
            {
                shellProcess.Kill(true);
            }
        }
    }

    private static async Task IgnoreCancellationAsync(Task task)
    {
        try
        {
            await task;
        }
        catch (OperationCanceledException)
        {
            // ignored
        }
    }
}
