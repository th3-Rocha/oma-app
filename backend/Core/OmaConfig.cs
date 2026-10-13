using System.Text.Json;

namespace Oma.Core;

public sealed class OmaConfig
{
    public const string Version = "2.0.0";
    public const string ServiceName = "oma-app";

    public int Port { get; set; } = 43658;
    public bool Auth { get; set; } = true;
    public string ScriptsDir { get; set; } = "";
    public string SoundsDir { get; set; } = "";

    public string ConfigDir { get; private set; } = "";
    public string DataDir { get; private set; } = "";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    /// <summary>~/.config/oma-app/config.json, then OMA_* environment overrides.</summary>
    public static OmaConfig Load()
    {
        var configDir = Path.Combine(
            Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") is { Length: > 0 } xdg ? xdg : Path.Combine(DesktopEnv.Home, ".config"),
            ServiceName);
        var dataDir = Path.Combine(DesktopEnv.Home, ".local/share", ServiceName);
        Directory.CreateDirectory(configDir);
        Directory.CreateDirectory(dataDir);

        var config = new OmaConfig();
        var file = Path.Combine(configDir, "config.json");
        if (File.Exists(file))
        {
            try
            {
                config = JsonSerializer.Deserialize<OmaConfig>(File.ReadAllText(file), Json) ?? config;
            }
            catch (JsonException ex)
            {
                Console.Error.WriteLine($"config.json ignored: {ex.Message}");
            }
        }

        if (int.TryParse(Environment.GetEnvironmentVariable("OMA_PORT"), out var port)) config.Port = port;
        if (Environment.GetEnvironmentVariable("OMA_AUTH") is { Length: > 0 } auth)
            config.Auth = auth is not ("0" or "false" or "off");
        if (Environment.GetEnvironmentVariable("OMA_SCRIPTS_DIR") is { Length: > 0 } scripts) config.ScriptsDir = scripts;
        if (Environment.GetEnvironmentVariable("OMA_SOUNDS_DIR") is { Length: > 0 } sounds) config.SoundsDir = sounds;

        if (string.IsNullOrWhiteSpace(config.ScriptsDir)) config.ScriptsDir = Path.Combine(configDir, "scripts");
        if (string.IsNullOrWhiteSpace(config.SoundsDir)) config.SoundsDir = Path.Combine(dataDir, "sounds");
        config.ScriptsDir = Expand(config.ScriptsDir);
        config.SoundsDir = Expand(config.SoundsDir);
        config.ConfigDir = configDir;
        config.DataDir = dataDir;
        return config;
    }

    private static string Expand(string path) =>
        path.StartsWith("~/") ? Path.Combine(DesktopEnv.Home, path[2..]) : path;
}
