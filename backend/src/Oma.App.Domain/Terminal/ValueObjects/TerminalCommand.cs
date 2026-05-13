namespace Oma.App.Domain.Terminal.ValueObjects;

public sealed record TerminalCommand
{
    public const int MaxLength = 2048;

    public string Value { get; }

    private TerminalCommand(string value)
    {
        Value = value;
    }

    public static bool TryCreate(string? rawValue, out TerminalCommand? command, out string? error)
    {
        var normalized = rawValue?.Trim();

        if (string.IsNullOrWhiteSpace(normalized))
        {
            command = null;
            error = "Command cannot be empty.";
            return false;
        }

        if (normalized.Length > MaxLength)
        {
            command = null;
            error = $"Command exceeds max length ({MaxLength}).";
            return false;
        }

        command = new TerminalCommand(normalized);
        error = null;
        return true;
    }
}
