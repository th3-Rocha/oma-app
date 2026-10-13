using System.Globalization;
using Oma.Core;

namespace Oma.Features;

public sealed record HostInfo(string Hostname, string Kernel, string CpuModel, int Cores, string? Omarchy);
public sealed record CpuInfo(double Usage, double[] Cores);
public sealed record MemInfo(long Total, long Used, long Available, long SwapTotal, long SwapUsed);
public sealed record GpuInfo(double? Usage, double? TempC, long? VramUsed, long? VramTotal);
public sealed record DiskInfo(string Mount, string Format, long Total, long Used, long Free);
public sealed record NetRate(string? Interface, string? Ip, double RxPerSec, double TxPerSec, long RxTotal, long TxTotal);
public sealed record BatteryInfo(double Percent, bool Charging);
public sealed record FanInfo(string Name, int Rpm);
public sealed record ProcInfo(int Pid, string Name, double Cpu, double Mem, long Rss);

public sealed record StatusSnapshot(
    long Ts,
    HostInfo Host,
    CpuInfo Cpu,
    double? CpuTempC,
    MemInfo Mem,
    GpuInfo? Gpu,
    IReadOnlyList<DiskInfo> Disks,
    NetRate Net,
    BatteryInfo? Battery,
    double UptimeSec,
    double[] Load,
    IReadOnlyList<FanInfo> Fans,
    IReadOnlyList<ProcInfo> Procs);

public sealed record KillRequest(int Pid, bool Force);

/// <summary>Reads /proc and /sys. Rates are deltas against the previous call, so keep one instance per stream.</summary>
public sealed class StatusSampler
{
    private static readonly Lazy<HostInfo> Host = new(ReadHost);

    private long[]? _prevTotal;
    private long[]? _prevIdle;
    private Dictionary<int, long> _prevProc = [];
    private long _prevRx, _prevTx;
    private DateTime _prevNetAt;

    public StatusSnapshot Sample()
    {
        var (cpu, totalDelta) = ReadCpu();
        var mem = ReadMem();
        var (cpuTemp, gpuTemp, fans) = ReadHwmon();
        return new StatusSnapshot(
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Host.Value,
            cpu,
            cpuTemp,
            mem,
            ReadGpu(gpuTemp),
            ReadDisks(),
            ReadNet(),
            ReadBattery(),
            ReadUptime(),
            ReadLoad(),
            fans,
            ReadProcs(totalDelta, cpu.Cores.Length, mem.Total));
    }

    private static HostInfo ReadHost()
    {
        var model = ReadLines("/proc/cpuinfo")
            .FirstOrDefault(line => line.StartsWith("model name"))?
            .Split(':', 2).ElementAtOrDefault(1)?.Trim() ?? "CPU";
        var omarchy = Sh.Has("omarchy-version")
            ? Sh.Run("omarchy-version", [], 3000).GetAwaiter().GetResult().Stdout.Trim()
            : null;
        return new HostInfo(
            Environment.MachineName,
            ReadText("/proc/sys/kernel/osrelease") ?? "",
            model,
            Environment.ProcessorCount,
            string.IsNullOrEmpty(omarchy) ? null : omarchy);
    }

    private (CpuInfo Cpu, long TotalDelta) ReadCpu()
    {
        var rows = ReadLines("/proc/stat").Where(line => line.StartsWith("cpu")).ToList();
        var total = new long[rows.Count];
        var idle = new long[rows.Count];
        for (var i = 0; i < rows.Count; i++)
        {
            var cols = rows[i].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var values = cols.Skip(1).Take(8).Select(v => long.TryParse(v, out var n) ? n : 0).ToArray();
            total[i] = values.Sum();
            idle[i] = values.ElementAtOrDefault(3) + values.ElementAtOrDefault(4);
        }

        var usage = new double[rows.Count];
        long totalDelta = 0;
        if (_prevTotal is not null && _prevIdle is not null && _prevTotal.Length == total.Length)
        {
            for (var i = 0; i < total.Length; i++)
            {
                var dTotal = total[i] - _prevTotal[i];
                var dIdle = idle[i] - _prevIdle[i];
                usage[i] = dTotal > 0 ? Math.Clamp(100.0 * (dTotal - dIdle) / dTotal, 0, 100) : 0;
            }

            totalDelta = total[0] - _prevTotal[0];
        }

        _prevTotal = total;
        _prevIdle = idle;
        return (new CpuInfo(Round(usage.FirstOrDefault()), usage.Skip(1).Select(Round).ToArray()), totalDelta);
    }

    private static MemInfo ReadMem()
    {
        var values = new Dictionary<string, long>();
        foreach (var line in ReadLines("/proc/meminfo"))
        {
            var parts = line.Split(':', 2);
            if (parts.Length != 2) continue;
            var number = parts[1].Trim().Split(' ')[0];
            if (long.TryParse(number, out var kb)) values[parts[0]] = kb * 1024;
        }

        var total = values.GetValueOrDefault("MemTotal");
        var available = values.GetValueOrDefault("MemAvailable");
        var swapTotal = values.GetValueOrDefault("SwapTotal");
        return new MemInfo(total, total - available, available, swapTotal, swapTotal - values.GetValueOrDefault("SwapFree"));
    }

    private static (double? Cpu, double? Gpu, List<FanInfo> Fans) ReadHwmon()
    {
        double? cpu = null, gpu = null;
        var fans = new List<FanInfo>();
        if (!Directory.Exists("/sys/class/hwmon")) return (cpu, gpu, fans);

        foreach (var dir in Directory.EnumerateDirectories("/sys/class/hwmon"))
        {
            var name = ReadText(Path.Combine(dir, "name")) ?? "";
            if (name is "k10temp" or "coretemp" or "zenpower" or "cpu_thermal")
                cpu ??= ReadMilli(Path.Combine(dir, "temp1_input"));
            else if (name is "amdgpu" or "nouveau" or "nvidia" or "i915" or "xe")
                gpu ??= ReadMilli(Path.Combine(dir, "temp1_input"));

            foreach (var file in SafeFiles(dir, "fan*_input"))
            {
                if (int.TryParse(ReadText(file), out var rpm) && rpm > 0)
                    fans.Add(new FanInfo($"{name} {Path.GetFileName(file).Replace("_input", "")}", rpm));
            }
        }

        // Laptops without a hwmon CPU sensor still expose a thermal zone.
        if (cpu is null && Directory.Exists("/sys/class/thermal"))
        {
            cpu = Directory.EnumerateDirectories("/sys/class/thermal", "thermal_zone*")
                .Select(zone => ReadMilli(Path.Combine(zone, "temp")))
                .FirstOrDefault(value => value is > 0);
        }

        return (cpu, gpu, fans);
    }

    private static GpuInfo? ReadGpu(double? temp)
    {
        if (!Directory.Exists("/sys/class/drm")) return temp is null ? null : new GpuInfo(null, temp, null, null);

        foreach (var card in Directory.EnumerateDirectories("/sys/class/drm", "card?"))
        {
            var device = Path.Combine(card, "device");
            if (!double.TryParse(ReadText(Path.Combine(device, "gpu_busy_percent")), NumberStyles.Float, CultureInfo.InvariantCulture, out var busy))
                continue;
            long? used = long.TryParse(ReadText(Path.Combine(device, "mem_info_vram_used")), out var u) ? u : null;
            long? total = long.TryParse(ReadText(Path.Combine(device, "mem_info_vram_total")), out var t) ? t : null;
            return new GpuInfo(busy, temp, used, total);
        }

        return temp is null ? null : new GpuInfo(null, temp, null, null);
    }

    private static List<DiskInfo> ReadDisks()
    {
        string[] formats = ["ext4", "btrfs", "xfs", "f2fs", "zfs", "ntfs", "ntfs3", "exfat", "bcachefs"];
        string[] skipped = ["/boot", "/efi", "/run", "/snap", "/var/lib/docker", "/var/lib/containers"];
        var disks = new List<DiskInfo>();
        foreach (var drive in DriveInfo.GetDrives().OrderBy(d => d.Name.Length))
        {
            try
            {
                if (!drive.IsReady || !formats.Contains(drive.DriveFormat) || drive.TotalSize <= 0) continue;
                if (skipped.Any(prefix => drive.Name.StartsWith(prefix))) continue;
                // btrfs subvolumes report the same pool once per mount point
                if (disks.Any(d => d.Total == drive.TotalSize && d.Free == drive.AvailableFreeSpace)) continue;
                disks.Add(new DiskInfo(drive.Name, drive.DriveFormat, drive.TotalSize, drive.TotalSize - drive.TotalFreeSpace, drive.AvailableFreeSpace));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // mount vanished or is not readable
            }
        }

        return disks;
    }

    private NetRate ReadNet()
    {
        long rx = 0, tx = 0;
        foreach (var line in ReadLines("/proc/net/dev").Skip(2))
        {
            var parts = line.Split(':', 2);
            if (parts.Length != 2 || NetInfo.IsVirtual(parts[0].Trim())) continue;
            var cols = parts[1].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (cols.Length < 9) continue;
            rx += long.TryParse(cols[0], out var r) ? r : 0;
            tx += long.TryParse(cols[8], out var t) ? t : 0;
        }

        var now = DateTime.UtcNow;
        var seconds = (now - _prevNetAt).TotalSeconds;
        var first = _prevNetAt == default || seconds <= 0;
        var rxRate = first ? 0 : Math.Max(0, (rx - _prevRx) / seconds);
        var txRate = first ? 0 : Math.Max(0, (tx - _prevTx) / seconds);
        _prevRx = rx;
        _prevTx = tx;
        _prevNetAt = now;

        var nic = NetInfo.Primary();
        return new NetRate(nic.Name, nic.Ip, Math.Round(rxRate), Math.Round(txRate), rx, tx);
    }

    private static BatteryInfo? ReadBattery()
    {
        if (!Directory.Exists("/sys/class/power_supply")) return null;
        foreach (var dir in Directory.EnumerateDirectories("/sys/class/power_supply", "BAT*"))
        {
            if (!double.TryParse(ReadText(Path.Combine(dir, "capacity")), NumberStyles.Float, CultureInfo.InvariantCulture, out var percent)) continue;
            var status = ReadText(Path.Combine(dir, "status")) ?? "";
            return new BatteryInfo(percent, status is "Charging" or "Full");
        }

        return null;
    }

    private static double ReadUptime() =>
        double.TryParse(ReadText("/proc/uptime")?.Split(' ')[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) ? seconds : 0;

    private static double[] ReadLoad() =>
        (ReadText("/proc/loadavg") ?? "").Split(' ').Take(3)
            .Select(v => double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : 0)
            .ToArray();

    private List<ProcInfo> ReadProcs(long totalDelta, int cores, long memTotal)
    {
        var current = new Dictionary<int, long>();
        var procs = new List<ProcInfo>();
        var pageSize = Environment.SystemPageSize;

        foreach (var dir in Directory.EnumerateDirectories("/proc"))
        {
            if (!int.TryParse(Path.GetFileName(dir), out var pid)) continue;
            var stat = ReadText(Path.Combine(dir, "stat"));
            if (stat is null) continue;

            // "pid (comm) state ..." and comm may itself contain spaces or parentheses
            var open = stat.IndexOf('(');
            var close = stat.LastIndexOf(')');
            if (open < 0 || close < open) continue;
            var name = stat[(open + 1)..close];
            var rest = stat[(close + 2)..].Split(' ');
            if (rest.Length < 22) continue;

            var ticks = (long.TryParse(rest[11], out var utime) ? utime : 0) + (long.TryParse(rest[12], out var stime) ? stime : 0);
            var rss = (long.TryParse(rest[21], out var pages) ? pages : 0) * pageSize;
            current[pid] = ticks;
            if (rss == 0) continue; // kernel threads

            var cpu = totalDelta > 0 && _prevProc.TryGetValue(pid, out var before)
                ? 100.0 * cores * Math.Max(0, ticks - before) / totalDelta
                : 0;
            procs.Add(new ProcInfo(pid, name, Round(cpu), memTotal > 0 ? Round(100.0 * rss / memTotal) : 0, rss));
        }

        _prevProc = current;
        return procs.OrderByDescending(p => p.Cpu).Take(12)
            .Union(procs.OrderByDescending(p => p.Rss).Take(12))
            .ToList();
    }

    private static double Round(double value) => Math.Round(value, 1);

    private static double? ReadMilli(string path) =>
        double.TryParse(ReadText(path), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? Math.Round(value / 1000.0, 1) : null;

    private static string? ReadText(string path)
    {
        try
        {
            return File.ReadAllText(path).Trim();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static IEnumerable<string> ReadLines(string path)
    {
        try
        {
            return File.ReadAllLines(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    private static IEnumerable<string> SafeFiles(string dir, string pattern)
    {
        try
        {
            return Directory.GetFiles(dir, pattern);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }
}

public static class StatusFeature
{
    public static void MapStatus(this WebApplication app)
    {
        app.Map("/ws/status", context => Ws.Serve(context, async (socket, ct) =>
        {
            var sampler = new StatusSampler();
            sampler.Sample(); // prime the deltas
            await Task.Delay(350, ct);
            while (!ct.IsCancellationRequested)
            {
                await socket.SendJson(sampler.Sample(), ct);
                await Task.Delay(1500, ct);
            }
        }));

        app.MapPost("/api/status/kill", async (KillRequest request) =>
        {
            if (request.Pid <= 1 || request.Pid == Environment.ProcessId)
                return Results.BadRequest(new { error = "PID inválido" });
            var result = await Sh.Run("kill", [request.Force ? "-KILL" : "-TERM", request.Pid.ToString()]);
            return result.Ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = result.Error });
        });
    }
}
