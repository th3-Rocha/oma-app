using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Oma.Core;

/// <summary>
/// A real pseudo-terminal. The master side is opened here; the child is started
/// through setsid(1) so the slave becomes its controlling terminal, which is what
/// makes job control, resize and full-screen programs behave.
/// </summary>
public sealed class Pty : IDisposable
{
    private const int O_RDWR = 0x2;
    private const int O_NOCTTY = 0x100;
    private const int O_CLOEXEC = 0x80000;
    private const ulong TIOCSWINSZ = 0x5414;
    private const short POLLIN = 0x1;
    private const int EINTR = 4;
    private const int EAGAIN = 11;

    [StructLayout(LayoutKind.Sequential)]
    private struct WinSize
    {
        public ushort Rows;
        public ushort Cols;
        public ushort XPixel;
        public ushort YPixel;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PollFd
    {
        public int Fd;
        public short Events;
        public short Revents;
    }

    [DllImport("libc", SetLastError = true)] private static extern int posix_openpt(int flags);
    [DllImport("libc", SetLastError = true)] private static extern int grantpt(int fd);
    [DllImport("libc", SetLastError = true)] private static extern int unlockpt(int fd);
    [DllImport("libc", SetLastError = true)] private static extern int ptsname_r(int fd, byte[] buffer, nuint length);
    [DllImport("libc", SetLastError = true)] private static extern int ioctl(int fd, ulong request, ref WinSize size);
    [DllImport("libc", SetLastError = true)] private static extern int poll(ref PollFd fds, nuint count, int timeoutMs);
    [DllImport("libc", SetLastError = true)] private static extern nint read(int fd, byte[] buffer, nuint count);
    [DllImport("libc", SetLastError = true)] private static extern nint write(int fd, ref byte buffer, nuint count);
    [DllImport("libc", SetLastError = true)] private static extern int close(int fd);

    private readonly object _writeGate = new();
    private readonly int _master;
    private readonly Process _process;
    private volatile bool _disposed;
    private int _readers;

    private Pty(int master, Process process)
    {
        _master = master;
        _process = process;
    }

    public static Pty Start(string file, IEnumerable<string> args, int cols, int rows, IDictionary<string, string>? env = null)
    {
        var master = posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC);
        if (master < 0) throw new IOException($"posix_openpt failed (errno {Marshal.GetLastPInvokeError()})");

        try
        {
            if (grantpt(master) != 0 || unlockpt(master) != 0)
                throw new IOException($"grantpt/unlockpt failed (errno {Marshal.GetLastPInvokeError()})");

            var name = new byte[128];
            if (ptsname_r(master, name, (nuint)name.Length) != 0)
                throw new IOException($"ptsname_r failed (errno {Marshal.GetLastPInvokeError()})");
            var slave = Encoding.ASCII.GetString(name, 0, Array.IndexOf(name, (byte)0));

            SetSize(master, cols, rows);

            // sh opens the slave as stdio, then setsid makes it the controlling tty.
            var command = new List<string> { "-c", "exec setsid -c -w \"$@\" <\"$OMA_PTS\" >\"$OMA_PTS\" 2>&1", "oma-pty", file };
            command.AddRange(args);
            var psi = Sh.Psi("/bin/sh", command);
            psi.Environment["OMA_PTS"] = slave;
            psi.Environment["TERM"] = "xterm-256color";
            psi.Environment["COLORTERM"] = "truecolor";
            if (env is not null)
            {
                foreach (var (key, value) in env) psi.Environment[key] = value;
            }

            var process = Process.Start(psi) ?? throw new IOException("could not start the shell");
            return new Pty(master, process);
        }
        catch
        {
            close(master);
            throw;
        }
    }

    public bool HasExited => _process.HasExited;

    /// <summary>Blocks until output arrives. Returns 0 once the terminal is gone.</summary>
    public int Read(byte[] buffer)
    {
        Interlocked.Increment(ref _readers);
        try
        {
            var fds = new PollFd { Fd = _master, Events = POLLIN };
            while (!_disposed)
            {
                fds.Revents = 0;
                var ready = poll(ref fds, 1, 250);
                if (ready < 0)
                {
                    if (Marshal.GetLastPInvokeError() == EINTR) continue;
                    return 0;
                }

                if (ready == 0) continue;

                var count = read(_master, buffer, (nuint)buffer.Length);
                if (count > 0) return (int)count;
                if (count < 0 && Marshal.GetLastPInvokeError() is EINTR or EAGAIN) continue;
                return 0; // EIO: every slave handle is closed
            }

            return 0;
        }
        finally
        {
            Interlocked.Decrement(ref _readers);
        }
    }

    public void Write(ReadOnlySpan<byte> data)
    {
        lock (_writeGate)
        {
            while (data.Length > 0 && !_disposed)
            {
                var written = write(_master, ref System.Runtime.InteropServices.MemoryMarshal.GetReference(data), (nuint)data.Length);
                if (written < 0)
                {
                    if (Marshal.GetLastPInvokeError() is EINTR or EAGAIN) continue;
                    return;
                }

                data = data[(int)written..];
            }
        }
    }

    public void Resize(int cols, int rows)
    {
        if (!_disposed) SetSize(_master, cols, rows);
    }

    private static void SetSize(int fd, int cols, int rows)
    {
        var size = new WinSize
        {
            Cols = (ushort)Math.Clamp(cols, 10, 500),
            Rows = (ushort)Math.Clamp(rows, 4, 300),
        };
        ioctl(fd, TIOCSWINSZ, ref size);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        try
        {
            if (!_process.HasExited) _process.Kill(entireProcessTree: true);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // already gone
        }

        // Readers poll with a short timeout, so they notice the flag and leave
        // before the descriptor is closed (and possibly reused).
        var waited = 0;
        while (Volatile.Read(ref _readers) > 0 && waited++ < 40) Thread.Sleep(25);

        close(_master);
        _process.Dispose();
    }
}
