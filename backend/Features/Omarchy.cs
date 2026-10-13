using System.Text.Json;
using Oma.Core;

namespace Oma.Features;

public sealed record OmarchyToggle(string Id, string Label, bool? Enabled);
public sealed record OmarchyState(
    bool Available, string? Version, string? Theme, IReadOnlyList<string> Themes,
    IReadOnlyList<OmarchyToggle> Toggles, string? PowerProfile, IReadOnlyList<string> PowerProfiles);
public sealed record NameRequest(string Name);

public static class Omarchy
{
    private static readonly (string Id, string Label, string Command)[] Toggles =
    [
        ("nightlight", "Luz noturna", "omarchy-toggle-nightlight"),
        ("idle", "Bloqueio por inatividade", "omarchy-toggle-idle"),
        ("bar", "Barra superior", "omarchy-toggle-bar"),
        ("notifications", "Silenciar notificações", "omarchy-toggle-notification-silencing"),
    ];

    public static bool Available => Sh.Has("omarchy-theme-set");

    public static async Task<Dictionary<string, string>> Colors(CancellationToken ct)
    {
        var colors = new Dictionary<string, string>();
        if (!Sh.Has("omarchy-theme-color")) return colors;

        var result = await Sh.Run("omarchy-theme-color", ["--all"], 3000, ct: ct);
        foreach (var line in result.Stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var cols = line.Split('\t');
            if (cols.Length == 2 && cols[1].StartsWith('#')) colors[cols[0]] = cols[1];
        }

        return colors;
    }

    public static async Task<OmarchyState> State(CancellationToken ct)
    {
        if (!Available) return new OmarchyState(false, null, null, [], [], null, []);

        var version = Sh.Run("omarchy-version", [], 3000, ct: ct);
        var theme = Sh.Run("omarchy-theme-current", [], 3000, ct: ct);
        var themes = Sh.Run("omarchy-theme-list", [], 3000, ct: ct);
        var night = Sh.Run("omarchy-toggle-nightlight", ["--status"], 3000, ct: ct);
        var profile = Sh.Run("powerprofilesctl", ["get"], 3000, ct: ct);
        var profiles = Sh.Run("omarchy-powerprofiles-list", [], 3000, ct: ct);
        await Task.WhenAll(version, theme, themes, night, profile, profiles);

        bool? nightOn = null;
        using (var doc = JsonX.TryParse(night.Result.Stdout))
        {
            if (doc?.RootElement.ValueKind == JsonValueKind.Object) nightOn = doc.RootElement.Flag("enabled");
        }

        return new OmarchyState(
            true,
            Text(version.Result),
            Text(theme.Result),
            Lines(themes.Result),
            Toggles.Where(t => Sh.Has(t.Command)).Select(t => new OmarchyToggle(t.Id, t.Label, t.Id == "nightlight" ? nightOn : null)).ToList(),
            profile.Result.Ok ? Text(profile.Result) : null,
            profiles.Result.Ok ? Lines(profiles.Result) : []);
    }

    public static string? ToggleCommand(string id) => Toggles.FirstOrDefault(t => t.Id == id).Command;

    private static string? Text(ShResult result) => result.Ok && result.Stdout.Trim() is { Length: > 0 } text ? text : null;

    private static List<string> Lines(ShResult result) =>
        result.Stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
}

public static class OmarchyFeature
{
    public static void MapOmarchy(this WebApplication app)
    {
        app.MapGet("/api/theme", async (CancellationToken ct) => Results.Ok(await Omarchy.Colors(ct)));

        app.MapGet("/api/omarchy", async (CancellationToken ct) => Results.Ok(await Omarchy.State(ct)));

        app.MapPost("/api/omarchy/theme", async (NameRequest request, CancellationToken ct) =>
        {
            var state = await Omarchy.State(ct);
            if (!state.Themes.Contains(request.Name)) return Results.NotFound(new { error = "Tema não encontrado" });
            var result = await Sh.Run("omarchy-theme-set", [request.Name], 45000, ct: ct);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = result.Error });
        });

        app.MapPost("/api/omarchy/background", async (CancellationToken ct) =>
        {
            var result = await Sh.Run("omarchy-theme-bg-next", [], 15000, ct: ct);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = result.Error });
        });

        app.MapPost("/api/omarchy/toggle/{id}", async (string id, CancellationToken ct) =>
        {
            if (Omarchy.ToggleCommand(id) is not { } command) return Results.NotFound(new { error = "Toggle desconhecido" });
            var result = await Sh.Run(command, [], 10000, ct: ct);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = result.Error });
        });

        app.MapPost("/api/omarchy/power-profile", async (NameRequest request, CancellationToken ct) =>
        {
            if (request.Name is not ("power-saver" or "balanced" or "performance")) return Results.BadRequest(new { error = "Perfil inválido" });
            var result = await Sh.Run("powerprofilesctl", ["set", request.Name], 5000, ct: ct);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = result.Error });
        });
    }
}
