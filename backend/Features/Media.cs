using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Oma.Core;

namespace Oma.Features;

public sealed record MediaPlayer(
    string Id, string Name, string Status, string? Title, string? Artist, string? Album,
    bool HasArt, long? DurationMs, long? PositionMs, double? Volume);
public sealed record AudioState(double? Volume, bool Muted, bool MicMuted);
public sealed record MediaState(IReadOnlyList<MediaPlayer> Players, string? Active, AudioState Audio);
public sealed record AudioSink(string Name, string Description, bool Active);

public sealed record MediaCommandRequest(string? Player, string Command);
public sealed record MediaSeekRequest(string? Player, long PositionMs);
public sealed record VolumeRequest(string? Player, double Volume);
public sealed record MuteRequest(string Target);
public sealed record SinkRequest(string Name);

/// <summary>Any MPRIS player through playerctl, system audio through WirePlumber.</summary>
public static partial class Media
{
    private const string Format =
        "{{playerInstance}}\t{{playerName}}\t{{status}}\t{{title}}\t{{artist}}\t{{album}}\t{{mpris:artUrl}}\t{{mpris:length}}\t{{position}}\t{{volume}}";

    private static readonly string[] Commands = ["play-pause", "play", "pause", "stop", "next", "previous"];

    [GeneratedRegex(@"^[A-Za-z0-9_.\-]{1,80}$")]
    private static partial Regex PlayerPattern();

    public static bool ValidPlayer(string? player) => player is not null && PlayerPattern().IsMatch(player);

    public static bool ValidCommand(string command) => Commands.Contains(command);

    private sealed record RawPlayer(MediaPlayer Player, string? ArtUrl);

    private static async Task<List<RawPlayer>> ReadPlayers(CancellationToken ct)
    {
        var result = await Sh.Run("playerctl", ["-a", "metadata", "--format", Format], 3000, ct: ct);
        var players = new List<RawPlayer>();
        foreach (var line in result.Stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var cols = line.Split('\t');
            if (cols.Length < 10 || !ValidPlayer(cols[0])) continue;

            var duration = long.TryParse(cols[7], out var micros) && micros > 0 ? micros / 1000 : (long?)null;
            // mpvpaper (the animated wallpaper) registers as an idle "mpv" player
            if (cols[1] == "mpv" && duration is null && cols[2] != "Playing") continue;

            var artUrl = string.IsNullOrWhiteSpace(cols[6]) ? null : cols[6];
            players.Add(new RawPlayer(
                new MediaPlayer(
                    cols[0], cols[1], cols[2], Empty(cols[3]), Empty(cols[4]), Empty(cols[5]), artUrl is not null, duration,
                    long.TryParse(cols[8], out var position) ? position / 1000 : null,
                    double.TryParse(cols[9], NumberStyles.Float, CultureInfo.InvariantCulture, out var volume) ? Math.Round(volume, 2) : null),
                artUrl));
        }

        return players;
    }

    public static async Task<MediaState> ReadState(CancellationToken ct)
    {
        var playersTask = ReadPlayers(ct);
        var sinkTask = Sh.Run("wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"], 2000, ct: ct);
        var sourceTask = Sh.Run("wpctl", ["get-volume", "@DEFAULT_AUDIO_SOURCE@"], 2000, ct: ct);
        await Task.WhenAll(playersTask, sinkTask, sourceTask);

        var players = playersTask.Result.Select(p => p.Player).ToList();
        var active = players.FirstOrDefault(p => p.Status == "Playing") ?? players.FirstOrDefault();

        // "Volume: 0.76 [MUTED]"
        var sink = sinkTask.Result.Stdout.Trim();
        var parts = sink.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        double? level = parts.Length > 1 && double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
        var audio = new AudioState(level, sink.Contains("MUTED"), sourceTask.Result.Stdout.Contains("MUTED"));
        return new MediaState(players, active?.Id, audio);
    }

    public static async Task<string?> ArtUrl(string player, CancellationToken ct) =>
        (await ReadPlayers(ct)).FirstOrDefault(p => p.Player.Id == player)?.ArtUrl;

    public static async Task<string?> ResolvePlayer(string? requested, CancellationToken ct)
    {
        if (ValidPlayer(requested)) return requested;
        return (await ReadState(ct)).Active;
    }

    public static async Task<List<AudioSink>> ReadSinks(CancellationToken ct)
    {
        var listTask = Sh.Run("pactl", ["-f", "json", "list", "sinks"], 3000, ct: ct);
        var defaultTask = Sh.Run("pactl", ["get-default-sink"], 3000, ct: ct);
        await Task.WhenAll(listTask, defaultTask);

        var current = defaultTask.Result.Stdout.Trim();
        using var doc = JsonX.TryParse(listTask.Result.Stdout);
        if (doc?.RootElement.ValueKind != JsonValueKind.Array) return [];
        return doc.RootElement.EnumerateArray()
            .Where(s => s.Str("name") is not null)
            .Select(s => new AudioSink(s.Str("name")!, s.Str("description") ?? s.Str("name")!, s.Str("name") == current))
            .ToList();
    }

    private static string? Empty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;
}

public static class MediaFeature
{
    public static void MapMedia(this WebApplication app)
    {
        app.MapGet("/api/media", async (CancellationToken ct) => Results.Ok(await Media.ReadState(ct)));

        app.MapGet("/api/media/art", async (string player, HttpContext context, CancellationToken ct) =>
        {
            if (!Media.ValidPlayer(player)) return Results.BadRequest();
            var url = await Media.ArtUrl(player, ct);
            if (url is null) return Results.NotFound();
            if (url.StartsWith("http://") || url.StartsWith("https://")) return Results.Redirect(url);
            if (!url.StartsWith("file://")) return Results.NotFound();

            var path = Uri.UnescapeDataString(new Uri(url).AbsolutePath);
            if (!File.Exists(path) || new FileInfo(path).Length > 8 * 1024 * 1024) return Results.NotFound();
            var bytes = await File.ReadAllBytesAsync(path, ct);
            var type = SniffImage(bytes);
            return type is null ? Results.NotFound() : Results.File(bytes, type);
        });

        app.MapPost("/api/media/command", async (MediaCommandRequest request, CancellationToken ct) =>
        {
            if (!Media.ValidCommand(request.Command)) return Results.BadRequest(new { error = "Comando inválido" });
            if (await Media.ResolvePlayer(request.Player, ct) is not { } player) return Results.NotFound(new { error = "Nenhum player ativo" });
            await Sh.Run("playerctl", ["-p", player, request.Command], 3000, ct: ct);
            return Results.Ok(await Media.ReadState(ct));
        });

        app.MapPost("/api/media/seek", async (MediaSeekRequest request, CancellationToken ct) =>
        {
            if (await Media.ResolvePlayer(request.Player, ct) is not { } player) return Results.NotFound(new { error = "Nenhum player ativo" });
            var seconds = (Math.Max(0, request.PositionMs) / 1000.0).ToString("0.###", CultureInfo.InvariantCulture);
            await Sh.Run("playerctl", ["-p", player, "position", seconds], 3000, ct: ct);
            return Results.Ok(await Media.ReadState(ct));
        });

        app.MapPost("/api/media/volume", async (VolumeRequest request, CancellationToken ct) =>
        {
            if (await Media.ResolvePlayer(request.Player, ct) is not { } player) return Results.NotFound(new { error = "Nenhum player ativo" });
            var volume = Math.Clamp(request.Volume, 0, 1).ToString("0.##", CultureInfo.InvariantCulture);
            await Sh.Run("playerctl", ["-p", player, "volume", volume], 3000, ct: ct);
            return Results.Ok(new { ok = true });
        });

        app.MapPost("/api/audio/volume", async (VolumeRequest request, CancellationToken ct) =>
        {
            var volume = Math.Clamp(request.Volume, 0, 1).ToString("0.##", CultureInfo.InvariantCulture);
            var result = await Sh.Run("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", volume], 3000, ct: ct);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = result.Error });
        });

        app.MapPost("/api/audio/mute", async (MuteRequest request, CancellationToken ct) =>
        {
            var target = request.Target == "source" ? "@DEFAULT_AUDIO_SOURCE@" : "@DEFAULT_AUDIO_SINK@";
            await Sh.Run("wpctl", ["set-mute", target, "toggle"], 3000, ct: ct);
            return Results.Ok(await Media.ReadState(ct));
        });

        app.MapGet("/api/audio/sinks", async (CancellationToken ct) => Results.Ok(await Media.ReadSinks(ct)));

        app.MapPost("/api/audio/sink", async (SinkRequest request, CancellationToken ct) =>
        {
            var sinks = await Media.ReadSinks(ct);
            if (sinks.All(s => s.Name != request.Name)) return Results.NotFound(new { error = "Saída não encontrada" });
            var result = await Sh.Run("pactl", ["set-default-sink", request.Name], 3000, ct: ct);
            return result.Ok ? Results.Ok(await Media.ReadSinks(ct)) : Results.BadRequest(new { error = result.Error });
        });
    }

    private static string? SniffImage(byte[] bytes)
    {
        if (bytes.Length < 12) return null;
        if (bytes[0] == 0xFF && bytes[1] == 0xD8) return "image/jpeg";
        if (bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47) return "image/png";
        if (bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F') return "image/gif";
        if (bytes[0] == 'R' && bytes[1] == 'I' && bytes[8] == 'W' && bytes[9] == 'E') return "image/webp";
        return null;
    }
}
