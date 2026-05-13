# oma-app mobile (Expo)

Frontend mobile do **oma-app**, com visual inspirado no **Omarchy OS** (Everforest/Evergarden), usando:

- **Inter** para UI
- **JetBrains Mono** para áreas terminais e comandos

## Fluxo atual

1. Tela inicial faz `ping` em `GET /api/ping`
2. Se receber `pong`, navega para o painel com 8 botões
3. Só o botão **Terminal** está ativo por enquanto
4. Tela de terminal conecta no backend em `ws://.../ws/terminal`

## Configuração por ambiente

Copie o arquivo de exemplo:

- `.env.example` -> `.env`

Variáveis disponíveis:

- `EXPO_PUBLIC_BACKEND_HTTP_URL`
- `EXPO_PUBLIC_BACKEND_WS_URL` (opcional)

Se `EXPO_PUBLIC_BACKEND_WS_URL` não for informado, o app deriva automaticamente de `EXPO_PUBLIC_BACKEND_HTTP_URL`.

## Exemplo para celular físico na mesma rede

```env
EXPO_PUBLIC_BACKEND_HTTP_URL=http://192.168.1.10:5272
EXPO_PUBLIC_BACKEND_WS_URL=ws://192.168.1.10:5272/ws/terminal
```

> Não use `localhost` no celular físico. Use o IP da sua máquina.

## Terminal

Recursos já habilitados:

- Connect/Disconnect manual
- Envio de comandos por texto
- Log terminal com cores por tipo de linha
- **Auto-reconnect** com toggle ON/OFF

## Running

```bash
npm install
npm run start
```

Scripts are already configured with `--host lan` for local network access.

Quick launch:

- `npm run android`
- `npm run ios`
- `npm run web`

## Backend local network binding (.NET)

The backend launch profile is configured to listen on all local interfaces:

- `http://0.0.0.0:5172`
- `https://0.0.0.0:7008`

So devices on your LAN can connect using your machine IP (for example `http://192.168.1.10:5172`).
