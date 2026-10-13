using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;
using Oma.Core;

namespace Oma.Features;

public sealed record HyprMonitor(string Name, int Width, int Height, int X, int Y, double Scale, bool Focused, int ActiveWorkspaceId);
public sealed record HyprWindow(
    string Address, string Class, string Title, int X, int Y, int Width, int Height,
    bool Floating, bool Fullscreen, int Pid, bool Focused);
public sealed record HyprWorkspace(int Id, string Name, string? Monitor, IReadOnlyList<HyprWindow> Windows);
public sealed record HyprState(
    bool Available, int ActiveWorkspaceId, string? FocusedAddress,
    IReadOnlyList<HyprMonitor> Monitors, IReadOnlyList<HyprWorkspace> Workspaces);

public sealed record HyprActionRequest(string Action, string? Address, int? Workspace, string? Direction, string? Name);

/// <summary>
/// Hyprland 0.5x+ dispatchers are Lua: `hyprctl dispatch 'hl.dsp.focus({ ... })'`.
/// </summary>
public static partial class Hypr
{
    [GeneratedRegex("^0x[0-9a-fA-F]+$")]
    private static partial Regex AddressPattern();

    [GeneratedRegex("^[A-Za-z0-9_:-]{1,40}$")]
    private static partial Regex NamePattern();

    public static bool ValidAddress(string? address) => address is not null && AddressPattern().IsMatch(address);

    public static bool ValidName(string? name) => name is not null && NamePattern().IsMatch(name);

    public static string Quote(string value) =>
        "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ").Replace("\r", " ") + "\"";

    public static async Task<(bool Ok, string Message)> Dispatch(string lua, CancellationToken ct = default)
    {
        var result = await Sh.Run("hyprctl", ["dispatch", lua], 4000, ct: ct);
        var output = result.Stdout.Trim();
        return (result.Ok && output == "ok", output.Length > 0 ? output : result.Error);
    }

    public static async Task<HyprState> ReadState(CancellationToken ct = default)
    {
        var monitorsTask = Sh.Run("hyprctl", ["-j", "monitors"], 3000, ct: ct);
        var workspacesTask = Sh.Run("hyprctl", ["-j", "workspaces"], 3000, ct: ct);
        var clientsTask = Sh.Run("hyprctl", ["-j", "clients"], 3000, ct: ct);
        var activeTask = Sh.Run("hyprctl", ["-j", "activewindow"], 3000, ct: ct);
        await Task.WhenAll(monitorsTask, workspacesTask, clientsTask, activeTask);

        using var monitorsDoc = JsonX.TryParse(monitorsTask.Result.Stdout);
        using var workspacesDoc = JsonX.TryParse(workspacesTask.Result.Stdout);
        using var clientsDoc = JsonX.TryParse(clientsTask.Result.Stdout);
        using var activeDoc = JsonX.TryParse(activeTask.Result.Stdout);
        if (monitorsDoc?.RootElement.ValueKind != JsonValueKind.Array
            || workspacesDoc?.RootElement.ValueKind != JsonValueKind.Array
            || clientsDoc?.RootElement.ValueKind != JsonValueKind.Array)
        {
            return new HyprState(false, 0, null, [], []);
        }

        var focused = activeDoc?.RootElement.Str("address");

        var monitors = monitorsDoc.RootElement.EnumerateArray()
            .Select(m => new HyprMonitor(
                m.Str("name") ?? "?", m.Int("width"), m.Int("height"), m.Int("x"), m.Int("y"),
                m.Num("scale", 1), m.Flag("focused"), m.Obj("activeWorkspace")?.Int("id") ?? 0))
            .ToList();

        var windows = clientsDoc.RootElement.EnumerateArray()
            .Where(c => c.Flag("mapped") && c.Str("address") is not null)
            .Select(c => (
                WorkspaceId: c.Obj("workspace")?.Int("id") ?? 0,
                Window: new HyprWindow(
                    c.Str("address")!, c.Str("class") ?? "", c.Str("title") ?? "",
                    c.At("at", 0), c.At("at", 1), c.At("size", 0), c.At("size", 1),
                    c.Flag("floating"), c.Flag("fullscreen"), c.Int("pid"), c.Str("address") == focused)))
            .ToList();

        var workspaces = workspacesDoc.RootElement.EnumerateArray()
            .Select(w => new HyprWorkspace(
                w.Int("id"), w.Str("name") ?? w.Int("id").ToString(), w.Str("monitor"),
                windows.Where(x => x.WorkspaceId == w.Int("id")).Select(x => x.Window).ToList()))
            .OrderBy(w => w.Id < 0 ? int.MaxValue : w.Id)
            .ToList();

        var active = monitors.FirstOrDefault(m => m.Focused)?.ActiveWorkspaceId ?? monitors.FirstOrDefault()?.ActiveWorkspaceId ?? 0;
        return new HyprState(true, active, focused, monitors, workspaces);
    }

    /// <summary>Hyprland's event socket: a line arrives whenever anything on the desktop changes.</summary>
    public sealed class Events : IDisposable
    {
        private readonly Socket _socket;
        private readonly byte[] _buffer = new byte[8192];
        private bool _dead;

        private Events(Socket socket) => _socket = socket;

        public static Events? TryConnect()
        {
            if (DesktopEnv.HyprSocketDir is not { } dir) return null;
            var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            try
            {
                socket.Connect(new UnixDomainSocketEndPoint(Path.Combine(dir, ".socket2.sock")));
                return new Events(socket);
            }
            catch (SocketException)
            {
                socket.Dispose();
                return null;
            }
        }

        /// <summary>Returns after a burst of events settles, or when <paramref name="timeout"/> passes.</summary>
        public async Task Wait(TimeSpan timeout, CancellationToken ct)
        {
            if (_dead)
            {
                await Task.Delay(1000, ct);
                return;
            }

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout);
            try
            {
                if (await _socket.ReceiveAsync(_buffer.AsMemory(), SocketFlags.None, cts.Token) == 0) _dead = true;
                await Task.Delay(60, ct);
                while (!_dead && _socket.Available > 0)
                {
                    if (await _socket.ReceiveAsync(_buffer.AsMemory(), SocketFlags.None, ct) == 0) _dead = true;
                }
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                // timeout: fall through to a periodic refresh
            }
            catch (SocketException)
            {
                _dead = true;
            }
        }

        public void Dispose() => _socket.Dispose();
    }
}

public static class HyprFeature
{
    private static readonly string[] Directions = ["l", "r", "u", "d"];

    public static void MapHypr(this WebApplication app)
    {
        app.MapGet("/api/hypr", async (CancellationToken ct) => Results.Ok(await Hypr.ReadState(ct)));

        app.Map("/ws/hypr", context => Ws.Serve(context, async (socket, ct) =>
        {
            using var events = Hypr.Events.TryConnect();
            string? last = null;
            while (!ct.IsCancellationRequested)
            {
                var json = JsonSerializer.Serialize(await Hypr.ReadState(ct), Ws.Json);
                if (json != last)
                {
                    await socket.SendText(json, ct);
                    last = json;
                }

                if (events is not null) await events.Wait(TimeSpan.FromSeconds(4), ct);
                else await Task.Delay(1200, ct);
            }
        }));

        app.MapPost("/api/hypr/action", async (HyprActionRequest request, CancellationToken ct) =>
        {
            var lua = BuildAction(request);
            if (lua is null) return Results.BadRequest(new { error = "Ação inválida" });

            var (ok, message) = await Hypr.Dispatch(lua, ct);
            return ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = message });
        });
    }

    private static string? BuildAction(HyprActionRequest request)
    {
        var window = Hypr.ValidAddress(request.Address) ? $"window = \"address:{request.Address}\"" : null;
        var needsWindow = request.Action is "focus" or "close" or "kill" or "float" or "fullscreen" or "maximize" or "move" or "swap";
        if (needsWindow && window is null) return null;

        return request.Action switch
        {
            "workspace" when request.Workspace is > 0 and < 100 => $"hl.dsp.focus({{ workspace = \"{request.Workspace}\" }})",
            "focus" => $"hl.dsp.focus({{ {window} }})",
            "close" => $"hl.dsp.window.close({{ {window} }})",
            "kill" => $"hl.dsp.window.kill({{ {window} }})",
            "float" => $"hl.dsp.window.float({{ action = \"toggle\", {window} }})",
            "fullscreen" => $"hl.dsp.window.fullscreen({{ mode = \"fullscreen\", {window} }})",
            "maximize" => $"hl.dsp.window.fullscreen({{ mode = \"maximized\", {window} }})",
            "move" when request.Workspace is > 0 and < 100 =>
                $"hl.dsp.window.move({{ workspace = \"{request.Workspace}\", follow = false, {window} }})",
            "swap" when Directions.Contains(request.Direction) =>
                $"hl.dsp.window.swap({{ direction = \"{request.Direction}\", {window} }})",
            "special" => $"hl.dsp.workspace.toggle_special({Hypr.Quote(Hypr.ValidName(request.Name) ? request.Name! : "scratchpad")})",
            _ => null,
        };
    }
}
