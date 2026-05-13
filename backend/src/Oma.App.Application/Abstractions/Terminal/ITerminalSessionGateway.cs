using System.Net.WebSockets;

namespace Oma.App.Application.Abstractions.Terminal;

public interface ITerminalSessionGateway
{
    Task HandleAsync(WebSocket webSocket, CancellationToken cancellationToken);
}
