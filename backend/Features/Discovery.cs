using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Oma.Core;

namespace Oma.Features;

public sealed record PingInfo(string Service, string Version, string Hostname, string? Mac, string? Ip, int Port, bool Auth);

public static class Ping
{
    public static PingInfo Build(OmaConfig config)
    {
        var nic = NetInfo.Primary();
        return new PingInfo(OmaConfig.ServiceName, OmaConfig.Version, Environment.MachineName, nic.Mac, nic.Ip, config.Port, config.Auth);
    }
}

/// <summary>Answers "OMA_DISCOVER" UDP broadcasts so the phone finds the PC without sweeping the subnet.</summary>
public sealed class DiscoveryService(OmaConfig config, ILogger<DiscoveryService> log) : BackgroundService
{
    public const string Probe = "OMA_DISCOVER";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        UdpClient udp;
        try
        {
            udp = new UdpClient(new IPEndPoint(IPAddress.Any, config.Port)) { EnableBroadcast = true };
        }
        catch (SocketException ex)
        {
            log.LogWarning("UDP discovery disabled: {Message}", ex.Message);
            return;
        }

        using (udp)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var packet = await udp.ReceiveAsync(stoppingToken);
                    if (!Encoding.ASCII.GetString(packet.Buffer).StartsWith(Probe, StringComparison.Ordinal)) continue;

                    var reply = JsonSerializer.SerializeToUtf8Bytes(Ping.Build(config), Ws.Json);
                    await udp.SendAsync(reply, packet.RemoteEndPoint, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (SocketException ex)
                {
                    log.LogDebug("discovery: {Message}", ex.Message);
                }
            }
        }
    }
}
