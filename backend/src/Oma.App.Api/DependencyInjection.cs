using Oma.App.Application.Abstractions.Terminal;
using Oma.App.Application.UseCases.Terminal;
using Oma.App.Infrastructure.Terminal;

namespace Oma.App.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddBackendServices(this IServiceCollection services)
    {
        services.AddScoped<HandleTerminalWebSocketUseCase>();
        services.AddScoped<ITerminalSessionGateway, TerminalSessionGateway>();

        return services;
    }
}
