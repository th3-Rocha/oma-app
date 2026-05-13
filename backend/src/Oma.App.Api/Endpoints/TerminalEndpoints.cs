using Oma.App.Application.UseCases.Terminal;

namespace Oma.App.Api.Endpoints;

public static class TerminalEndpoints
{
    public static IEndpointRouteBuilder MapTerminalEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.Map("/ws/terminal", async context =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("Expected a WebSocket request.");
                return;
            }

            using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
            var useCase = context.RequestServices.GetRequiredService<HandleTerminalWebSocketUseCase>();
            await useCase.ExecuteAsync(webSocket, context.RequestAborted);
        })
        .WithDisplayName("TerminalWebSocket");

        return endpoints;
    }
}
