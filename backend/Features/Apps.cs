using System.Text.RegularExpressions;
using Oma.Core;

namespace Oma.Features;

public sealed record DesktopApp(string Id, string Name, string? Comment, string? Category, bool Terminal);
public sealed record LaunchRequest(string Id, int? Workspace);

/// <summary>Launcher backed by the .desktop files the desktop's own launcher reads.</summary>
public sealed partial class AppCatalog
{
    private sealed record Entry(DesktopApp App, string Exec);

    [GeneratedRegex("%[a-zA-Z]")]
    private static partial Regex FieldCode();

    private readonly object _gate = new();
    private Dictionary<string, Entry> _entries = [];
    private DateTime _loadedAt = DateTime.MinValue;

    public IReadOnlyList<DesktopApp> List()
    {
        Refresh();
        lock (_gate) return _entries.Values.Select(e => e.App).OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public (string Exec, bool Terminal)? Find(string id)
    {
        Refresh();
        lock (_gate) return _entries.TryGetValue(id, out var entry) ? (entry.Exec, entry.App.Terminal) : null;
    }

    private void Refresh()
    {
        lock (_gate)
        {
            if (DateTime.UtcNow - _loadedAt < TimeSpan.FromSeconds(60)) return;
            _loadedAt = DateTime.UtcNow;

            // Later directories lose: a user's own .desktop file overrides the system one.
            string[] dirs =
            [
                Path.Combine(DesktopEnv.Home, ".local/share/applications"),
                Path.Combine(DesktopEnv.Home, ".local/share/flatpak/exports/share/applications"),
                "/var/lib/flatpak/exports/share/applications",
                "/usr/local/share/applications",
                "/usr/share/applications",
            ];

            var entries = new Dictionary<string, Entry>();
            foreach (var dir in dirs.Where(Directory.Exists))
            {
                foreach (var file in Directory.EnumerateFiles(dir, "*.desktop"))
                {
                    var id = Path.GetFileNameWithoutExtension(file);
                    if (entries.ContainsKey(id)) continue;
                    if (Parse(id, file) is { } entry) entries[id] = entry;
                    else entries[id] = null!; // hidden here means hidden everywhere
                }
            }

            _entries = entries.Where(pair => pair.Value is not null).ToDictionary(pair => pair.Key, pair => pair.Value);
        }
    }

    private static Entry? Parse(string id, string file)
    {
        var values = new Dictionary<string, string>();
        try
        {
            var inMain = false;
            foreach (var raw in File.ReadLines(file))
            {
                var line = raw.Trim();
                if (line.StartsWith('['))
                {
                    if (inMain) break;
                    inMain = line == "[Desktop Entry]";
                    continue;
                }

                if (!inMain || line.StartsWith('#')) continue;
                var split = line.IndexOf('=');
                if (split > 0) values.TryAdd(line[..split].Trim(), line[(split + 1)..].Trim());
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }

        if (values.GetValueOrDefault("Type", "Application") != "Application") return null;
        if (values.GetValueOrDefault("NoDisplay") == "true" || values.GetValueOrDefault("Hidden") == "true") return null;
        if (!values.TryGetValue("Name", out var name) || !values.TryGetValue("Exec", out var exec)) return null;

        exec = FieldCode().Replace(exec, "").Replace("%%", "%").Trim();
        if (exec.Length == 0) return null;

        var category = values.GetValueOrDefault("Categories")?.Split(';', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        var terminal = values.GetValueOrDefault("Terminal") == "true";
        return new Entry(new DesktopApp(id, name, values.GetValueOrDefault("Comment"), category, terminal), exec);
    }
}

public static class AppsFeature
{
    public static void MapApps(this WebApplication app)
    {
        app.MapGet("/api/apps", (AppCatalog catalog) => Results.Ok(catalog.List()));

        app.MapPost("/api/apps/launch", async (LaunchRequest request, AppCatalog catalog, CancellationToken ct) =>
        {
            if (catalog.Find(request.Id) is not { } found) return Results.NotFound(new { error = "App não encontrado" });

            var command = found.Terminal ? $"xdg-terminal-exec {found.Exec}" : found.Exec;
            var rule = request.Workspace is > 0 and < 100 ? $", {{ workspace = \"{request.Workspace} silent\" }}" : "";
            var (ok, message) = await Hypr.Dispatch($"hl.dsp.exec_cmd({Hypr.Quote(command)}{rule})", ct);
            return ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = message });
        });
    }
}
