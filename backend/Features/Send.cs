using Oma.Core;

namespace Oma.Features;

public sealed record TextRequest(string Text);
public sealed record NotifyRequest(string Title, string? Body);
public sealed record KeyRequest(string Key, string[]? Mods);

/// <summary>Phone → desktop: clipboard, typed text, key presses, notifications, links, screenshots.</summary>
public static class SendFeature
{
    private static readonly string[] Keys =
    [
        "Return", "Escape", "Tab", "BackSpace", "Delete", "space", "Up", "Down", "Left", "Right",
        "Home", "End", "Page_Up", "Page_Down", "F5", "F11",
        "XF86AudioPlay", "XF86AudioNext", "XF86AudioPrev", "XF86AudioMute", "XF86AudioRaiseVolume", "XF86AudioLowerVolume",
    ];

    private static readonly string[] Mods = ["ctrl", "alt", "shift", "logo"];

    public static void MapSend(this WebApplication app)
    {
        app.MapGet("/api/clipboard", async (CancellationToken ct) =>
        {
            var result = await Sh.Run("wl-paste", ["--no-newline", "--type", "text"], 3000, ct: ct);
            return Results.Ok(new { text = result.Ok ? result.Stdout : "" });
        });

        app.MapPost("/api/clipboard", async (TextRequest request, CancellationToken ct) =>
        {
            // wl-copy forks and keeps serving the selection, so its output must not be awaited
            var result = await Sh.Run("wl-copy", [], 3000, stdin: request.Text ?? "", capture: false, ct: ct);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = "wl-copy falhou" });
        });

        app.MapPost("/api/input/type", async (TextRequest request, CancellationToken ct) =>
        {
            if (string.IsNullOrEmpty(request.Text) || request.Text.Length > 4000) return Results.BadRequest(new { error = "Texto inválido" });
            var result = await Sh.Run("wtype", ["--", request.Text], 15000, ct: ct);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = result.Error });
        });

        app.MapPost("/api/input/key", async (KeyRequest request, CancellationToken ct) =>
        {
            var single = request.Key.Length == 1 && char.IsLetterOrDigit(request.Key[0]);
            if (!single && !Keys.Contains(request.Key)) return Results.BadRequest(new { error = "Tecla inválida" });
            var mods = (request.Mods ?? []).Where(Mods.Contains).Distinct().ToArray();

            var args = new List<string>();
            foreach (var mod in mods) args.AddRange(["-M", mod]);
            args.AddRange(["-k", request.Key]);
            foreach (var mod in mods.Reverse()) args.AddRange(["-m", mod]);

            var result = await Sh.Run("wtype", args, 5000, ct: ct);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = result.Error });
        });

        app.MapPost("/api/notify", async (NotifyRequest request, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Title)) return Results.BadRequest(new { error = "Título vazio" });
            var result = await Sh.Run("notify-send", ["-a", "Oma App", "--", request.Title, request.Body ?? ""], 4000, ct: ct);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = result.Error });
        });

        app.MapPost("/api/open", async (TextRequest request, CancellationToken ct) =>
        {
            if (!Uri.TryCreate(request.Text?.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
                return Results.BadRequest(new { error = "Só links http(s)" });
            var (ok, message) = await Hypr.Dispatch($"hl.dsp.exec_cmd({Hypr.Quote("xdg-open '" + uri.AbsoluteUri.Replace("'", "%27") + "'")})", ct);
            return ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = message });
        });

        app.MapGet("/api/screen", async (string? monitor, double? scale, CancellationToken ct) =>
        {
            var args = new List<string> { "-t", "jpeg", "-q", "72", "-s", Math.Clamp(scale ?? 0.6, 0.2, 1).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) };
            if (Hypr.ValidName(monitor)) args.AddRange(["-o", monitor!]);
            args.Add("-");
            var image = await Sh.RunBinary("grim", args, 8000, ct);
            return image is null ? Results.StatusCode(StatusCodes.Status503ServiceUnavailable) : Results.File(image, "image/jpeg");
        });
    }
}
