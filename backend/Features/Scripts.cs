using System.Text.RegularExpressions;
using Oma.Core;

namespace Oma.Features;

public sealed record ScriptInfo(string Id, string Label, string? Description);
public sealed record ScriptResult(string Id, bool Ok, int ExitCode, string Output);

/// <summary>One-tap scripts: anything in the scripts directory. A "# desc: ..." comment becomes the subtitle.</summary>
public static partial class Scripts
{
    private const int MaxOutput = 16 * 1024;

    [GeneratedRegex(@"^#\s*desc(ription)?:\s*(.+)$", RegexOptions.IgnoreCase)]
    private static partial Regex DescPattern();

    public static List<ScriptInfo> List(OmaConfig config)
    {
        if (!Directory.Exists(config.ScriptsDir)) return [];
        return Directory.EnumerateFiles(config.ScriptsDir)
            .Where(file => !Path.GetFileName(file).StartsWith('.') && !file.EndsWith('~') && !file.EndsWith(".md"))
            .OrderBy(file => file, StringComparer.OrdinalIgnoreCase)
            .Select(file => new ScriptInfo(
                Path.GetFileName(file),
                Path.GetFileNameWithoutExtension(file).Replace('-', ' ').Replace('_', ' '),
                Describe(file)))
            .ToList();
    }

    public static async Task<ScriptResult?> Run(OmaConfig config, string id, CancellationToken ct)
    {
        // The id is a bare file name, so it cannot point outside the scripts directory.
        if (id != Path.GetFileName(id)) return null;
        var path = Path.Combine(config.ScriptsDir, id);
        if (!File.Exists(path)) return null;

        var executable = (File.GetUnixFileMode(path) & UnixFileMode.UserExecute) != 0;
        var result = executable
            ? await Sh.Run(path, [], 30000, cwd: config.ScriptsDir, ct: ct)
            : await Sh.Run("bash", [path], 30000, cwd: config.ScriptsDir, ct: ct);

        var output = string.Join('\n', new[] { result.Stdout.Trim(), result.Stderr.Trim() }.Where(part => part.Length > 0));
        if (output.Length > MaxOutput) output = "…" + output[^MaxOutput..];
        return new ScriptResult(id, result.Ok, result.ExitCode, output);
    }

    private static string? Describe(string file)
    {
        try
        {
            return File.ReadLines(file).Take(12)
                .Select(line => DescPattern().Match(line.Trim()))
                .FirstOrDefault(match => match.Success)?.Groups[2].Value.Trim();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}

public static class ScriptsFeature
{
    public static void MapScripts(this WebApplication app)
    {
        app.MapGet("/api/scripts", (OmaConfig config) => Results.Ok(new { dir = config.ScriptsDir, scripts = Scripts.List(config) }));

        app.MapPost("/api/scripts/{id}", async (string id, OmaConfig config, CancellationToken ct) =>
            await Scripts.Run(config, id, ct) is { } result ? Results.Ok(result) : Results.NotFound(new { error = "Script não encontrado" }));
    }
}
