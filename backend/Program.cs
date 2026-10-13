using System.Net;
using Oma.Core;
using Oma.Features;

[assembly: System.Runtime.Versioning.SupportedOSPlatform("linux")]

var config = OmaConfig.Load();

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    // wwwroot sits next to the binary, whatever directory systemd starts us in
    ContentRootPath = AppContext.BaseDirectory,
});
builder.WebHost.UseUrls($"http://0.0.0.0:{config.Port}");
builder.Logging.AddSimpleConsole(options => options.SingleLine = true);
// the phone pings every few seconds; per-request logs would flood the journal
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);

builder.Services.AddSingleton(config);
builder.Services.AddSingleton<AuthStore>();
builder.Services.AddSingleton<ClientTracker>();
builder.Services.AddSingleton<AppCatalog>();
builder.Services.AddSingleton<PowerService>();
builder.Services.AddSingleton<NatureMixer>();
builder.Services.AddHostedService<DiscoveryService>();

var app = builder.Build();
var auth = app.Services.GetRequiredService<AuthStore>();
var clients = app.Services.GetRequiredService<ClientTracker>();

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });

// Everything under /api and /ws needs a paired device's token, except discovery and pairing.
// /api/local/* is for the desktop itself (the bar widget): loopback only, no token.
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";
    var remote = context.Connection.RemoteIpAddress;

    if (path.StartsWith("/api/local/"))
    {
        if (remote is null || !IPAddress.IsLoopback(remote))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        await next();
        return;
    }

    var header = context.Request.Headers.Authorization.ToString();
    var token = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
        ? header[7..].Trim()
        : context.Request.Query["token"].ToString();
    var device = auth.Find(token);

    var guarded = (path.StartsWith("/api/") || path.StartsWith("/ws/"))
        && path != "/api/ping" && !path.StartsWith("/api/pair/");
    if (guarded && config.Auth && device is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { error = "unauthorized" });
        return;
    }

    if (path.StartsWith("/api/") || path.StartsWith("/ws/")) clients.Touch(remote, device?.Name);
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/ping", () => Results.Ok(Ping.Build(config)));

app.MapPost("/api/pair/start", async (PairStartRequest? request) =>
{
    var code = auth.StartPairing();
    if (code is null) return Results.StatusCode(StatusCodes.Status429TooManyRequests);

    app.Logger.LogInformation("Pairing code for {Device}: {Code}", request?.DeviceName ?? "device", code);
    await Sh.Run("notify-send",
        ["-a", "Oma App", "-u", "critical", "-t", "120000", $"Código de pareamento: {code[..3]} {code[3..]}", $"Pedido por: {request?.DeviceName ?? "celular"}"],
        3000);
    return Results.Ok(new { ok = true, expiresInSec = 120 });
});

app.MapPost("/api/pair/finish", (PairFinishRequest request) =>
    auth.FinishPairing(request.Code ?? "", request.DeviceName ?? "")
        is { } device
        ? Results.Ok(new { token = device.Token, deviceId = device.Id })
        : Results.BadRequest(new { error = "Código inválido ou expirado" }));

// Lets you read the pending code from a shell on the PC itself (never over the network).
app.MapGet("/api/pair/code", (HttpContext context) =>
    context.Connection.RemoteIpAddress is { } ip && IPAddress.IsLoopback(ip)
        ? Results.Ok(new { code = auth.PendingCode })
        : Results.StatusCode(StatusCodes.Status403Forbidden));

app.MapGet("/api/local/status", () =>
{
    var nic = NetInfo.Primary();
    return Results.Ok(new
    {
        running = true,
        version = OmaConfig.Version,
        port = config.Port,
        ip = nic.Ip,
        uptimeSec = (long)(DateTime.UtcNow - clients.StartedAt).TotalSeconds,
        paired = auth.Devices.Select(d => d.Name).ToList(),
        connected = clients.Connected(),
        pairingCode = auth.PendingCode,
    });
});

app.MapGet("/api/devices", () => Results.Ok(auth.Devices.Select(d => new { d.Id, d.Name, d.CreatedAt })));
app.MapDelete("/api/devices/{id}", (string id) => auth.Remove(id) ? Results.Ok(new { ok = true }) : Results.NotFound());

app.MapStatus();
app.MapHypr();
app.MapApps();
app.MapMedia();
app.MapPower();
app.MapOmarchy();
app.MapScripts();
app.MapNature();
app.MapSend();
app.MapTerminal();

app.Logger.LogInformation("oma-app {Version} on port {Port} (auth {Auth})", OmaConfig.Version, config.Port, config.Auth ? "on" : "off");
app.Run();

internal sealed record PairStartRequest(string? DeviceName);
internal sealed record PairFinishRequest(string? Code, string? DeviceName);
