using Oma.App.Api;
using Oma.App.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddBackendServices();
builder.Services.AddCors(options =>
{
    options.AddPolicy("DevCors", policy =>
    {
        policy
            .AllowAnyOrigin()
            .AllowAnyMethod()
            .AllowAnyHeader();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("DevCors");
app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(120),
    AllowedOrigins =
    {
        "http://localhost:8081",
        "http://localhost:19006",
        "http://localhost:5173",
        "http://127.0.0.1:8081",
        "http://127.0.0.1:19006",
        "http://127.0.0.1:5173",
        "http://192.168.18.9:8081",
        "http://192.168.18.9:19006",
        "http://192.168.18.9:5173"
    }
});

app.MapGet("/api/ping", () =>
{
    return Results.Ok(new
    {
        message = "pong",
        service = "oma-app-backend",
        timestamp = DateTimeOffset.UtcNow
    });
})
.WithName("Ping")
.WithTags("Health")
.WithOpenApi();

app.MapTerminalEndpoints();

app.Run();
