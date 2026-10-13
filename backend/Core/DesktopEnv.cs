using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Oma.Core;

/// <summary>
/// The server usually runs as a systemd user service, which starts without the
/// Hyprland/Wayland session variables. Every child process gets them from here.
/// </summary>
public static class DesktopEnv
{
    [DllImport("libc")]
    private static extern uint geteuid();

    private static readonly object Gate = new();
    private static DateTime _resolvedAt = DateTime.MinValue;
    private static string? _hyprSignature;
    private static string? _waylandDisplay;

    public static string Home { get; } = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    public static string RuntimeDir { get; } =
        Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR") is { Length: > 0 } dir ? dir : $"/run/user/{geteuid()}";

    public static string OmarchyPath { get; } =
        Environment.GetEnvironmentVariable("OMARCHY_PATH") is { Length: > 0 } path ? path
        : Directory.Exists("/usr/share/omarchy") ? "/usr/share/omarchy"
        : Path.Combine(Home, ".local/share/omarchy");

    public static string PathVariable { get; } = BuildPath();

    public static string? HyprSignature
    {
        get { Resolve(); return _hyprSignature; }
    }

    public static string? HyprSocketDir =>
        HyprSignature is { } signature ? Path.Combine(RuntimeDir, "hypr", signature) : null;

    public static void Apply(ProcessStartInfo psi)
    {
        Resolve();
        psi.Environment["XDG_RUNTIME_DIR"] = RuntimeDir;
        psi.Environment["PATH"] = PathVariable;
        psi.Environment["OMARCHY_PATH"] = OmarchyPath;
        if (_hyprSignature is not null) psi.Environment["HYPRLAND_INSTANCE_SIGNATURE"] = _hyprSignature;
        if (_waylandDisplay is not null) psi.Environment["WAYLAND_DISPLAY"] = _waylandDisplay;
        if (!psi.Environment.ContainsKey("DBUS_SESSION_BUS_ADDRESS"))
            psi.Environment["DBUS_SESSION_BUS_ADDRESS"] = $"unix:path={RuntimeDir}/bus";
        if (!psi.Environment.ContainsKey("XDG_CURRENT_DESKTOP"))
            psi.Environment["XDG_CURRENT_DESKTOP"] = "Hyprland";
    }

    private static void Resolve()
    {
        lock (Gate)
        {
            if (DateTime.UtcNow - _resolvedAt < TimeSpan.FromSeconds(3)) return;
            _resolvedAt = DateTime.UtcNow;
            _hyprSignature = FindHyprSignature();
            _waylandDisplay = FindWaylandDisplay();
        }
    }

    private static string? FindHyprSignature()
    {
        var root = Path.Combine(RuntimeDir, "hypr");
        var fromEnv = Environment.GetEnvironmentVariable("HYPRLAND_INSTANCE_SIGNATURE");
        if (!string.IsNullOrEmpty(fromEnv) && File.Exists(Path.Combine(root, fromEnv, ".socket.sock"))) return fromEnv;
        if (!Directory.Exists(root)) return null;

        return new DirectoryInfo(root).GetDirectories()
            .Where(d => File.Exists(Path.Combine(d.FullName, ".socket.sock")))
            .OrderByDescending(d => d.CreationTimeUtc)
            .FirstOrDefault()?.Name;
    }

    private static string? FindWaylandDisplay()
    {
        var fromEnv = Environment.GetEnvironmentVariable("WAYLAND_DISPLAY");
        if (!string.IsNullOrEmpty(fromEnv) && File.Exists(Path.Combine(RuntimeDir, fromEnv))) return fromEnv;
        if (!Directory.Exists(RuntimeDir)) return null;

        return Directory.EnumerateFiles(RuntimeDir, "wayland-*")
            .Select(Path.GetFileName)
            .Where(name => name is not null && !name.EndsWith(".lock"))
            .OrderBy(name => name)
            .LastOrDefault();
    }

    private static string BuildPath()
    {
        var parts = new List<string>
        {
            Path.Combine(Home, ".local/bin"),
            Path.Combine(OmarchyPath, "bin"),
            Path.Combine(Home, ".local/share/omarchy/bin"),
        };
        parts.AddRange((Environment.GetEnvironmentVariable("PATH") ?? "").Split(':', StringSplitOptions.RemoveEmptyEntries));
        parts.AddRange(["/usr/local/bin", "/usr/bin", "/bin"]);
        return string.Join(':', parts.Where(Directory.Exists).Distinct());
    }
}
