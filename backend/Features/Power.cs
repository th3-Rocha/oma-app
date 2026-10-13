using Oma.Core;

namespace Oma.Features;

public sealed record PowerAction(string Id, string Label, string Description, bool Danger);
public sealed record PowerTimer(string Action, long At);
public sealed record PowerState(IReadOnlyList<PowerAction> Actions, PowerTimer? Timer);
public sealed record TimerRequest(string Action, int Minutes);

public sealed class PowerService
{
    private const string TimerUnit = "oma-app-timer";

    private static readonly PowerAction[] Actions =
    [
        new("lock", "Bloquear", "Trava a sessão", false),
        new("screen-off", "Tela off", "Desliga os monitores", false),
        new("screen-on", "Tela on", "Liga os monitores", false),
        new("screensaver", "Screensaver", "Abre o screensaver do Omarchy", false),
        new("suspend", "Suspender", "Suspende para a RAM", true),
        new("logout", "Logout", "Encerra a sessão Hyprland", true),
        new("reboot", "Reiniciar", "Reinicia o PC", true),
        new("shutdown", "Desligar", "Desliga o PC", true),
    ];

    private readonly object _gate = new();
    private PowerTimer? _timer;

    public async Task<PowerState> State()
    {
        PowerTimer? timer;
        lock (_gate) timer = _timer;
        if (timer is not null)
        {
            var active = await Sh.Run("systemctl", ["--user", "is-active", $"{TimerUnit}.timer"], 2000);
            if (active.Stdout.Trim() is not ("active" or "activating"))
            {
                lock (_gate) _timer = null;
                timer = null;
            }
        }

        return new PowerState(Actions, timer);
    }

    public async Task<(bool Found, bool Ok, string? Error)> Execute(string id)
    {
        if (Actions.All(a => a.Id != id)) return (false, false, "Ação desconhecida");

        switch (id)
        {
            case "lock":
                return Started(Sh.Has("omarchy-system-lock")
                    ? Sh.Detach("omarchy-system-lock", [])
                    : Sh.Detach("loginctl", ["lock-session"]));
            case "screen-off":
                return Dispatched(await Hypr.Dispatch("hl.dsp.dpms({ action = \"off\" })"));
            case "screen-on":
                return Dispatched(await Hypr.Dispatch("hl.dsp.dpms({ action = \"on\" })"));
            case "screensaver":
                return Started(Sh.Detach("omarchy-launch-screensaver", ["force"]));
            case "suspend":
                return Started(Sh.Detach("systemctl", ["suspend"]));
            case "logout":
                if (Sh.Has("omarchy-system-logout")) return Started(Sh.Detach("omarchy-system-logout", []));
                return Dispatched(await Hypr.Dispatch("hl.dsp.exit()"));
            case "reboot":
                return Started(Sh.Has("omarchy-system-reboot")
                    ? Sh.Detach("omarchy-system-reboot", [])
                    : Sh.Detach("systemctl", ["reboot"]));
            default:
                return Started(Sh.Has("omarchy-system-shutdown")
                    ? Sh.Detach("omarchy-system-shutdown", [])
                    : Sh.Detach("systemctl", ["poweroff"]));
        }
    }

    /// <summary>A transient systemd timer, so the countdown survives a restart of this server.</summary>
    public async Task<(bool Ok, string? Error)> SetTimer(string action, int minutes)
    {
        var verb = action switch { "shutdown" => "poweroff", "suspend" => "suspend", "reboot" => "reboot", _ => null };
        if (verb is null || minutes is < 1 or > 24 * 60) return (false, "Timer inválido");

        await CancelTimer();
        var result = await Sh.Run("systemd-run",
            ["--user", "--collect", "--quiet", $"--unit={TimerUnit}", $"--on-active={minutes}m", "--timer-property=AccuracySec=1s", "systemctl", verb]);
        if (!result.Ok) return (false, result.Error);

        lock (_gate) _timer = new PowerTimer(action, DateTimeOffset.UtcNow.AddMinutes(minutes).ToUnixTimeMilliseconds());
        return (true, null);
    }

    public async Task CancelTimer()
    {
        await Sh.Run("systemctl", ["--user", "stop", $"{TimerUnit}.timer"], 3000);
        lock (_gate) _timer = null;
    }

    private static (bool, bool, string?) Started(bool ok) => (true, ok, ok ? null : "Não foi possível executar");

    private static (bool, bool, string?) Dispatched((bool Ok, string Message) result) => (true, result.Ok, result.Ok ? null : result.Message);
}

public static class PowerFeature
{
    public static void MapPower(this WebApplication app)
    {
        app.MapGet("/api/power", async (PowerService power) => Results.Ok(await power.State()));

        app.MapPost("/api/power/timer", async (TimerRequest request, PowerService power) =>
        {
            var (ok, error) = await power.SetTimer(request.Action, request.Minutes);
            return ok ? Results.Ok(await power.State()) : Results.BadRequest(new { error });
        });

        app.MapDelete("/api/power/timer", async (PowerService power) =>
        {
            await power.CancelTimer();
            return Results.Ok(await power.State());
        });

        app.MapPost("/api/power/{id}", async (string id, PowerService power) =>
        {
            var (found, ok, error) = await power.Execute(id);
            if (!found) return Results.NotFound(new { error });
            return ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error });
        });
    }
}
