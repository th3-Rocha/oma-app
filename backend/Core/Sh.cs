using System.ComponentModel;
using System.Diagnostics;
using System.Text;

namespace Oma.Core;

public sealed record ShResult(int ExitCode, string Stdout, string Stderr)
{
    public bool Ok => ExitCode == 0;
    public string Error => string.IsNullOrWhiteSpace(Stderr) ? Stdout.Trim() : Stderr.Trim();
}

/// <summary>Runs external commands with the desktop session environment applied.</summary>
public static class Sh
{
    public static ProcessStartInfo Psi(string file, IEnumerable<string> args, string? cwd = null)
    {
        var psi = new ProcessStartInfo(file)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = cwd ?? DesktopEnv.Home,
        };
        foreach (var arg in args) psi.ArgumentList.Add(arg);
        DesktopEnv.Apply(psi);
        return psi;
    }

    public static bool Has(string command) =>
        DesktopEnv.PathVariable.Split(':').Any(dir => File.Exists(Path.Combine(dir, command)));

    public static async Task<ShResult> Run(
        string file,
        IEnumerable<string> args,
        int timeoutMs = 5000,
        string? stdin = null,
        bool capture = true,
        string? cwd = null,
        CancellationToken ct = default)
    {
        var (exitCode, stdout, stderr) = await Exec(file, args, timeoutMs, stdin, capture, cwd, ct);
        return new ShResult(exitCode, Encoding.UTF8.GetString(stdout), stderr);
    }

    public static async Task<byte[]?> RunBinary(string file, IEnumerable<string> args, int timeoutMs = 8000, CancellationToken ct = default)
    {
        var (exitCode, stdout, _) = await Exec(file, args, timeoutMs, null, true, null, ct);
        return exitCode == 0 && stdout.Length > 0 ? stdout : null;
    }

    /// <summary>Starts a command and does not wait for it.</summary>
    public static bool Detach(string file, IEnumerable<string> args)
    {
        try
        {
            using var process = Process.Start(Psi(file, args));
            return process is not null;
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
        {
            return false;
        }
    }

    private static async Task<(int ExitCode, byte[] Stdout, string Stderr)> Exec(
        string file, IEnumerable<string> args, int timeoutMs, string? stdin, bool capture, string? cwd, CancellationToken ct)
    {
        var psi = Psi(file, args, cwd);
        psi.RedirectStandardInput = stdin is not null;
        psi.RedirectStandardOutput = capture;
        psi.RedirectStandardError = capture;

        Process process;
        try
        {
            process = Process.Start(psi) ?? throw new InvalidOperationException("process did not start");
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
        {
            return (127, [], $"{file}: {ex.Message}");
        }

        using (process)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeoutMs);

            // Pumped by hand: a command that leaves a background child holding the
            // pipe open must not keep us waiting for EOF after it has exited.
            var stdout = new MemoryStream();
            var stderr = new MemoryStream();
            var pumps = capture
                ? Task.WhenAll(
                    Pump(process.StandardOutput.BaseStream, stdout),
                    Pump(process.StandardError.BaseStream, stderr))
                : Task.CompletedTask;

            try
            {
                if (stdin is not null)
                {
                    await process.StandardInput.WriteAsync(stdin.AsMemory(), cts.Token);
                    process.StandardInput.Close();
                }

                await process.WaitForExitAsync(cts.Token);
                await Task.WhenAny(pumps, Task.Delay(300, CancellationToken.None));
                return (process.ExitCode, Snapshot(stdout), Encoding.UTF8.GetString(Snapshot(stderr)));
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch { /* already gone */ }
                return (124, Snapshot(stdout), $"{file}: timeout");
            }
            catch (IOException ex)
            {
                return (1, Snapshot(stdout), ex.Message);
            }
        }
    }

    private static async Task Pump(Stream source, MemoryStream target)
    {
        var buffer = new byte[16 * 1024];
        try
        {
            int read;
            while ((read = await source.ReadAsync(buffer)) > 0)
            {
                lock (target) target.Write(buffer, 0, read);
            }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or OperationCanceledException)
        {
            // pipe closed under us
        }
    }

    private static byte[] Snapshot(MemoryStream stream)
    {
        lock (stream) return stream.ToArray();
    }
}
