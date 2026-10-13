using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace Oma.Core;

public sealed record PrimaryInterface(string? Name, string? Mac, string? Ip);

public static class NetInfo
{
    private static readonly string[] VirtualPrefixes = ["lo", "docker", "br-", "veth", "virbr", "tailscale", "tun", "wg"];

    public static bool IsVirtual(string name) => VirtualPrefixes.Any(name.StartsWith);

    /// <summary>The interface that owns the default route: the one a magic packet has to reach.</summary>
    public static PrimaryInterface Primary()
    {
        var name = DefaultRouteInterface();
        var nics = NetworkInterface.GetAllNetworkInterfaces();
        var nic = nics.FirstOrDefault(n => n.Name == name)
            ?? nics.FirstOrDefault(n => n.OperationalStatus == OperationalStatus.Up && !IsVirtual(n.Name));
        if (nic is null) return new PrimaryInterface(null, null, null);

        var raw = nic.GetPhysicalAddress().ToString();
        var mac = raw.Length == 12
            ? string.Join(':', Enumerable.Range(0, 6).Select(i => raw.Substring(i * 2, 2))).ToLowerInvariant()
            : null;
        var ip = nic.GetIPProperties().UnicastAddresses
            .FirstOrDefault(a => a.Address.AddressFamily == AddressFamily.InterNetwork)?.Address.ToString();
        return new PrimaryInterface(nic.Name, mac, ip);
    }

    private static string? DefaultRouteInterface()
    {
        try
        {
            return File.ReadLines("/proc/net/route")
                .Skip(1)
                .Select(line => line.Split('\t', StringSplitOptions.RemoveEmptyEntries))
                .Where(cols => cols.Length > 6 && cols[1] == "00000000")
                .OrderBy(cols => int.TryParse(cols[6], out var metric) ? metric : int.MaxValue)
                .Select(cols => cols[0])
                .FirstOrDefault();
        }
        catch (IOException)
        {
            return null;
        }
    }
}
