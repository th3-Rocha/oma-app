# oma-app

Controle remoto do meu desktop **Omarchy** (Arch + Hyprland) pelo celular. Uso interno, self-hosted, só na rede local.

```
celular (app Expo/React Native)  ──HTTP + WebSocket──▶  PC (backend ASP.NET, serviço systemd de usuário)
        └── Wake-on-LAN (UDP direto do celular, com o PC desligado)
```

## O que faz

| Tela | Função |
| --- | --- |
| **Início** | Estado do PC, botão **Ligar PC** (Wake-on-LAN), CPU/RAM/temperatura, player e volume |
| **Conexão** | Procura o PC na rede (broadcast UDP, depois varredura da sub-rede), IP manual, pareamento |
| **Monitor** | CPU por núcleo com histórico, memória, GPU, discos, rede, processos (segure para encerrar) |
| **Mídia** | Qualquer player MPRIS (Spotify, navegador, mpv…): capa, seek, volume, mudo, microfone, saída de áudio |
| **Workspaces** | Mapa das janelas por workspace, focar/mover/fechar/flutuar/tela cheia, lançador de apps |
| **Terminal** | Shell de verdade (PTY) com xterm.js, barra de teclas, sessão persistente com tmux |
| **Scripts** | Roda com um toque qualquer script de `~/.config/oma-app/scripts` e mostra a saída |
| **Energia** | Bloquear, tela on/off, suspender, logout, reiniciar, desligar, timer de desligamento |
| **Omarchy** | Trocar tema e wallpaper, luz noturna e outros toggles, perfil de energia |
| **Nature** | Mixer de sons ambiente (um volume por categoria) tocando no PC |
| **Enviar** | Clipboard nos dois sentidos, digitar texto/teclas na janela ativa, abrir link, notificação |
| **Tela** | Screenshot do desktop, com modo ao vivo |

O app adota as cores do tema atual do Omarchy.

## Instalar no PC

Precisa de `dotnet-sdk` e `aspnet-runtime` (10). O resto já vem no Omarchy
(`hyprctl`, `playerctl`, `wpctl`, `grim`, `wl-clipboard`, `wtype`, `mpv`, `tmux`).

```sh
scripts/install.sh              # compila, instala em ~/.local/share/oma-app e sobe o serviço
scripts/install.sh --firewall   # idem + libera a porta 43658 (TCP e UDP) no ufw para a sub-rede
```

- Serviço: `systemctl --user status oma-app` · logs: `journalctl --user -u oma-app -f`
- Configuração: `~/.config/oma-app/config.json` (`port`, `auth`, `scriptsDir`, `soundsDir`)
- Remover: `scripts/uninstall.sh`
- Rodar do código-fonte, em outra porta: `scripts/dev.sh`

### Widget na barra do Omarchy

O `install.sh` também instala o plugin `rocha.oma-app` (em `desktop/omarchy-plugin/`) na barra:
ícone apagado = backend rodando sem celular, ícone + número = celulares conectados, vermelho = backend parado.
Passe o mouse para ver quem está conectado/pareado; clique esquerdo manda os detalhes numa notificação,
clique do meio reinicia o serviço. Ele lê `localhost:43658/api/local/status` (só acessível do próprio PC).

### Wake-on-LAN

O pacote mágico sai do celular, então só funciona no mesmo Wi-Fi/rede do PC. No PC:

```sh
sudo ethtool enp5s0 | grep Wake-on     # "g" = ligado
sudo ethtool -s enp5s0 wol g           # liga (e habilite também na BIOS)
```

O MAC é aprendido sozinho na primeira conexão; dá para editar em **Conexão**.

## Pareamento

Tudo em `/api` e `/ws` exige um token (o backend expõe um terminal, então não fica aberto na rede).
No app: **Conexão → Pedir código**. O PC mostra uma notificação com 6 dígitos; digite no celular.
Sem a notificação à vista: `curl -s localhost:43658/api/pair/code` no próprio PC.
Dispositivos pareados ficam em `~/.config/oma-app/devices.json`.

## App (APK)

```sh
cd mobile
npm install
npm run build:apk          # EAS, perfil "preview" → APK
npm run build:apk:local    # mesmo build, na própria máquina (precisa do Android SDK)
npm run typecheck && npm run lint
```

Nada de IP ou MAC embutido no build: o app descobre o PC em tempo de execução.

## Estrutura

```
backend/            ASP.NET minimal API (net10)
  Core/             shell com o ambiente da sessão, PTY, auth, websocket
  Features/         um arquivo por recurso (Hypr, Media, Status, Terminal, …)
  wwwroot/          página do terminal (xterm.js), servida para a WebView do app
mobile/             app Expo Router
  app/              telas
  lib/              conexão, descoberta, wake-on-lan, tema
scripts/            install / uninstall / dev + exemplos de scripts remotos
sounds/             sons do mixer (uma pasta por categoria)
```

Sons: só `fire` e `rain` têm arquivos hoje; qualquer pasta nova em `sounds/` com áudio vira um canal.
Os áudios ficam fora do git (são maiores que o limite de 100 MB do GitHub).

Nota: o Hyprland 0.5x+ do Omarchy 4 usa dispatchers em Lua (`hyprctl dispatch 'hl.dsp.focus({ ... })'`);
é essa a sintaxe que o backend emite.
