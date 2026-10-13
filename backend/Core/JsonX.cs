using System.Text.Json;

namespace Oma.Core;

/// <summary>Forgiving readers for the JSON that hyprctl and pactl print.</summary>
public static class JsonX
{
    public static string? Str(this JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    public static int Int(this JsonElement element, string name, int fallback = 0) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) ? value.AsInt(fallback) : fallback;

    public static double Num(this JsonElement element, string name, double fallback = 0) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number
            ? value.GetDouble()
            : fallback;

    /// <summary>Hyprland has flipped fields like "fullscreen" between bool and int across releases.</summary>
    public static bool Flag(this JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.Number => value.GetDouble() != 0,
            _ => false,
        };

    public static JsonElement? Obj(this JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    public static int At(this JsonElement element, string name, int index) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.Array && value.GetArrayLength() > index
            ? value[index].AsInt(0)
            : 0;

    private static int AsInt(this JsonElement value, int fallback) =>
        value.ValueKind == JsonValueKind.Number ? (int)Math.Round(value.GetDouble()) : fallback;

    public static JsonDocument? TryParse(string text)
    {
        try
        {
            return JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
