# oma-app backend

Backend da aplicação **oma-app**, construído com **ASP.NET Core 8** e organizado em estilo **DDD + Clean Architecture**.

## Estrutura

- `src/Oma.App.Api`: camada de entrada (HTTP/WebSocket), configuração e DI
- `src/Oma.App.Application`: casos de uso e contratos (abstrações)
- `src/Oma.App.Domain`: regras de domínio e value objects
- `src/Oma.App.Infrastructure`: implementações técnicas (gateways/adapters)
- `tests`: pasta reservada para testes automatizados

## Endpoints atuais

### Health
- `GET /api/ping`

Resposta esperada:

```json
{
  "message": "pong",
  "service": "oma-app-backend",
  "timestamp": "2026-01-01T12:00:00+00:00"
}
```

### Terminal (WebSocket)
- `GET /ws/terminal` (upgrade para WebSocket)

Comportamento atual:
- envia mensagem de boas-vindas ao conectar
- recebe texto puro como comando
- valida comando (não vazio, limite de tamanho)
- devolve saída simulada (`stub`) para cada comando

> Observação: execução real de shell ainda não foi habilitada por segurança; esta etapa prepara a base arquitetural.

## Como rodar

1. Entre na pasta da API:
   - `cd backend/src/Oma.App.Api`
2. Execute:
   - `dotnet run`
3. Testes rápidos:
   - HTTP: `GET /api/ping`
   - WebSocket: conectar em `ws://localhost:<porta>/ws/terminal`

Em desenvolvimento, Swagger disponível em `/swagger`.
