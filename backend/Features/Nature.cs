using System.Diagnostics;
using System.Globalization;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Oma.Core;

namespace Oma.Features;

public sealed record NatureChannel(string Id, string Name, double Volume, bool Playing, int Files);
public sealed record NatureState(bool Active, IReadOnlyList<NatureChannel> Channels, string SoundsDir);
public sealed record NatureMasterRequest(bool On);
public sealed record NatureVolumeRequest(string Channel, double Volume);

/// <summary>
/// Ambient mixer: one looping mpv per sound category, volumes changed live over mpv's IPC socket.
/// </summary>
public sealed class NatureMixer : IDisposable
{
    private static readonly string[] AudioExtensions = [".mp3", ".ogg", ".opus", ".flac", ".wav", ".m4a"];

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly OmaConfig _config;
    private readonly string _stateFile;
    private readonly string _socketDir;
    private readonly Dictionary<string, Process> _players = [];
    private Dictionary<string, double> _volumes = [];
    private bool _active;

    public NatureMixer(OmaConfig config, IHostApplicationLifetime lifetime)
    {
        _config = config;
        _stateFile = Path.Combine(config.DataDir, "nature.json");
        _socketDir = Path.Combine(DesktopEnv.RuntimeDir, "oma-app");
        Directory.CreateDirectory(_socketDir);
        lifetime.ApplicationStopping.Register(Dispose);

        if (!File.Exists(_stateFile)) return;
        try
        {
            _volumes = JsonSerializer.Deserialize<Dictionary<string, double>>(File.ReadAllText(_stateFile)) ?? [];
        }
        catch (JsonException)
        {
            _volumes = [];
        }
    }

    public async Task<NatureState> State()
    {
        await _gate.WaitAsync();
        try { return Snapshot(); }
        finally { _gate.Release(); }
    }

    public async Task<NatureState> SetMaster(bool on)
    {
        await _gate.WaitAsync();
        try
        {
            _active = on;
            await Reconcile();
            return Snapshot();
        }
        finally { _gate.Release(); }
    }

    public async Task<NatureState?> SetVolume(string channel, double volume)
    {
        await _gate.WaitAsync();
        try
        {
            if (!Channels().ContainsKey(channel)) return null;
            _volumes[channel] = Math.Round(Math.Clamp(volume, 0, 1), 2);
            File.WriteAllText(_stateFile, JsonSerializer.Serialize(_volumes));
            await Reconcile();
            return Snapshot();
        }
        finally { _gate.Release(); }
    }

    private Dictionary<string, string[]> Channels()
    {
        if (!Directory.Exists(_config.SoundsDir)) return [];
        return Directory.EnumerateDirectories(_config.SoundsDir)
            .Select(dir => (Id: Path.GetFileName(dir), Files: Directory.EnumerateFiles(dir)
                .Where(file => AudioExtensions.Contains(Path.GetExtension(file).ToLowerInvariant())).ToArray()))
            .Where(channel => channel.Files.Length > 0)
            .OrderBy(channel => channel.Id)
            .ToDictionary(channel => channel.Id, channel => channel.Files);
    }

    private NatureState Snapshot()
    {
        var channels = Channels().Select(pair => new NatureChannel(
            pair.Key,
            char.ToUpperInvariant(pair.Key[0]) + pair.Key[1..],
            _volumes.GetValueOrDefault(pair.Key),
            _players.TryGetValue(pair.Key, out var process) && !process.HasExited,
            pair.Value.Length)).ToList();
        return new NatureState(_active, channels, _config.SoundsDir);
    }

    private async Task Reconcile()
    {
        var channels = Channels();
        foreach (var id in _players.Keys.ToList())
        {
            var wanted = _active && channels.ContainsKey(id) && _volumes.GetValueOrDefault(id) > 0;
            if (!wanted || _players[id].HasExited) Stop(id);
        }

        if (!_active) return;

        foreach (var (id, files) in channels)
        {
            var volume = _volumes.GetValueOrDefault(id);
            if (volume <= 0) continue;

            if (_players.ContainsKey(id))
            {
                await SendVolume(id, volume);
                continue;
            }

            var file = files[Random.Shared.Next(files.Length)];
            var psi = Sh.Psi("mpv",
            [
                // --no-config keeps user scripts (MPRIS) out, so these never show up as media players
                "--no-config", "--no-video", "--really-quiet", "--no-terminal", "--loop-file=inf",
                "--audio-client-name=oma-nature",
                $"--volume={Percent(volume)}",
                $"--input-ipc-server={SocketPath(id)}",
                file,
            ]);
            try
            {
                if (Process.Start(psi) is { } process) _players[id] = process;
            }
            catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
            {
                // mpv missing: the channel just stays silent
            }
        }
    }

    private async Task SendVolume(string id, double volume)
    {
        var command = Encoding.UTF8.GetBytes($"{{\"command\":[\"set_property\",\"volume\",{Percent(volume)}]}}\n");
        for (var attempt = 0; attempt < 5; attempt++)
        {
            using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            try
            {
                await socket.ConnectAsync(new UnixDomainSocketEndPoint(SocketPath(id)));
                await socket.SendAsync(command);
                return;
            }
            catch (SocketException)
            {
                await Task.Delay(120); // mpv has not created its socket yet
            }
        }
    }

    private void Stop(string id)
    {
        if (!_players.Remove(id, out var process)) return;
        try
        {
            if (!process.HasExited) process.Kill();
        }
        catch (InvalidOperationException) { }
        process.Dispose();
        try { File.Delete(SocketPath(id)); } catch (IOException) { }
    }

    private string SocketPath(string id) => Path.Combine(_socketDir, $"nature-{id}.sock");

    private static string Percent(double volume) => (volume * 100).ToString("0", CultureInfo.InvariantCulture);

    public void Dispose()
    {
        foreach (var id in _players.Keys.ToList()) Stop(id);
    }
}

public static class NatureFeature
{
    public static void MapNature(this WebApplication app)
    {
        app.MapGet("/api/nature", async (NatureMixer mixer) => Results.Ok(await mixer.State()));

        app.MapPost("/api/nature/master", async (NatureMasterRequest request, NatureMixer mixer) =>
            Results.Ok(await mixer.SetMaster(request.On)));

        app.MapPost("/api/nature/volume", async (NatureVolumeRequest request, NatureMixer mixer) =>
            await mixer.SetVolume(request.Channel, request.Volume) is { } state
                ? Results.Ok(state)
                : Results.NotFound(new { error = "Canal não encontrado" }));
    }
}
