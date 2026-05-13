using System.Net.WebSockets;
using Oma.App.Application.Abstractions.Terminal;

namespace Oma.App.Application.UseCases.Terminal;

public sealed class HandleTerminalWebSocketUseCase
{
    private readonly ITerminalSessionGateway _terminalSessionGateway;

    public HandleTerminalWebSocketUseCase(ITerminalSessionGateway terminalSessionGateway)
    {
        _terminalSessionGateway = terminalSessionGateway;
    }

    public Task ExecuteAsync(WebSocket webSocket, CancellationToken cancellationToken)
    {
        return _terminalSessionGateway.HandleAsync(webSocket, cancellationToken);
    }
}
