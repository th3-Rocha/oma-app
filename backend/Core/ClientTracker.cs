using System.Collections.Concurrent;
using System.Net;

namespace Oma.Core;

public sealed record SeenClient(string Ip, string? Name, int IdleSec);

/// <summary>
/// Remembers which phones talked to us recently. The app pings every few seconds
/// while it is open, so "seen in the last few seconds" is what "connected" means here.
/// </summary>
public sealed class ClientTracker
{
    private static readonly TimeSpan ConnectedWindow = TimeSpan.FromSeconds(12);

    private readonly ConcurrentDictionary<string, (DateTime At, string? Name)> _seen = new();

    public DateTime StartedAt { get; } = DateTime.UtcNow;

    public void Touch(IPAddress? address, string? deviceName)
    {
        if (address is null || IPAddress.IsLoopback(address)) return;
        var ip = (address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address).ToString();
        _seen.AddOrUpdate(ip,
            _ => (DateTime.UtcNow, deviceName),
            (_, previous) => (DateTime.UtcNow, deviceName ?? previous.Name));
    }

    public IReadOnlyList<SeenClient> Connected()
    {
        var now = DateTime.UtcNow;
        foreach (var (ip, entry) in _seen)
        {
            if (now - entry.At > TimeSpan.FromHours(1)) _seen.TryRemove(ip, out _);
        }

        return _seen
            .Where(pair => now - pair.Value.At <= ConnectedWindow)
            .Select(pair => new SeenClient(pair.Key, pair.Value.Name, (int)(now - pair.Value.At).TotalSeconds))
            .OrderBy(client => client.IdleSec)
            .ToList();
    }
}
