using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Oma.Core;

public sealed record PairedDevice(string Id, string Name, string Token, DateTimeOffset CreatedAt);

/// <summary>
/// Phones pair once with a 6-digit code shown on the desktop and get a token
/// that every other request must carry.
/// </summary>
public sealed class AuthStore
{
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(2);
    private const int MaxAttempts = 5;

    private readonly object _gate = new();
    private readonly string _file;
    private List<PairedDevice> _devices = [];

    private string? _code;
    private DateTimeOffset _codeExpires;
    private DateTimeOffset _codeIssued;
    private int _attempts;

    public AuthStore(OmaConfig config)
    {
        _file = Path.Combine(config.ConfigDir, "devices.json");
        if (!File.Exists(_file)) return;
        try
        {
            _devices = JsonSerializer.Deserialize<List<PairedDevice>>(File.ReadAllText(_file), OmaConfig.Json) ?? [];
        }
        catch (JsonException)
        {
            _devices = [];
        }
    }

    public IReadOnlyList<PairedDevice> Devices
    {
        get { lock (_gate) return _devices.ToList(); }
    }

    public string? PendingCode
    {
        get { lock (_gate) return _code is not null && DateTimeOffset.UtcNow < _codeExpires ? _code : null; }
    }

    /// <summary>Returns null when a code was issued moments ago (keeps the desktop from being spammed).</summary>
    public string? StartPairing()
    {
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            if (_code is not null && now - _codeIssued < TimeSpan.FromSeconds(3)) return null;
            _code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
            _codeIssued = now;
            _codeExpires = now + CodeLifetime;
            _attempts = 0;
            return _code;
        }
    }

    public PairedDevice? FinishPairing(string code, string deviceName)
    {
        lock (_gate)
        {
            if (_code is null || DateTimeOffset.UtcNow >= _codeExpires) return null;
            if (++_attempts > MaxAttempts)
            {
                _code = null;
                return null;
            }

            if (!Same(code.Trim(), _code)) return null;

            _code = null;
            var device = new PairedDevice(
                Guid.NewGuid().ToString("N")[..8],
                string.IsNullOrWhiteSpace(deviceName) ? "device" : deviceName.Trim(),
                Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant(),
                DateTimeOffset.UtcNow);
            _devices.Add(device);
            Save();
            return device;
        }
    }

    public bool Validate(string? token) => Find(token) is not null;

    public PairedDevice? Find(string? token)
    {
        if (string.IsNullOrEmpty(token)) return null;
        lock (_gate) return _devices.FirstOrDefault(device => Same(token, device.Token));
    }

    public bool Remove(string id)
    {
        lock (_gate)
        {
            var removed = _devices.RemoveAll(device => device.Id == id) > 0;
            if (removed) Save();
            return removed;
        }
    }

    private void Save()
    {
        File.WriteAllText(_file, JsonSerializer.Serialize(_devices, OmaConfig.Json));
        File.SetUnixFileMode(_file, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }

    private static bool Same(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
}
