#!/usr/bin/env bash
# Builds the backend and runs it as a systemd user service on this machine.
#   scripts/install.sh              build + install + (re)start
#   scripts/install.sh --firewall   also open the port in ufw for the local subnet (asks for sudo)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$HOME/.local/share/oma-app"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/oma-app"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
PORT="${OMA_PORT:-43658}"

command -v dotnet >/dev/null || { echo "dotnet SDK não encontrado (sudo pacman -S dotnet-sdk aspnet-runtime)"; exit 1; }

echo "==> Compilando o backend"
systemctl --user stop oma-app.service 2>/dev/null || true
dotnet publish "$ROOT/backend/Oma.Server.csproj" -c Release -o "$APP_DIR/server" --nologo -v quiet

echo "==> Configuração em $CONFIG_DIR"
mkdir -p "$CONFIG_DIR/scripts" "$UNIT_DIR"
if [ -z "$(ls -A "$CONFIG_DIR/scripts")" ]; then
  cp "$ROOT"/scripts/examples/*.sh "$CONFIG_DIR/scripts/"
fi
if [ ! -f "$CONFIG_DIR/config.json" ]; then
  cat >"$CONFIG_DIR/config.json" <<JSON
{
  "port": $PORT,
  "auth": true,
  "scriptsDir": "$CONFIG_DIR/scripts",
  "soundsDir": "$ROOT/sounds"
}
JSON
fi

echo "==> Serviço systemd (usuário)"
cat >"$UNIT_DIR/oma-app.service" <<UNIT
[Unit]
Description=Oma App backend (controle remoto do Omarchy)
After=network-online.target

[Service]
ExecStart=$APP_DIR/server/Oma.Server
Restart=always
RestartSec=3
Environment=DOTNET_NOLOGO=1

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now oma-app.service
systemctl --user restart oma-app.service

if [ "${1:-}" = "--firewall" ] && command -v ufw >/dev/null; then
  SUBNET="$(ip -4 route show scope link | awk '!/docker|br-/ {print $1; exit}')"
  echo "==> Liberando a porta $PORT para $SUBNET no ufw"
  sudo ufw allow from "$SUBNET" to any port "$PORT" proto tcp comment 'oma-app'
  sudo ufw allow from "$SUBNET" to any port "$PORT" proto udp comment 'oma-app discovery'
fi

sleep 1
echo
systemctl --user --no-pager --lines=0 status oma-app.service | head -4 || true
echo
echo "Backend em http://$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}'):$PORT"
echo "Logs:   journalctl --user -u oma-app -f"
echo "Se o celular não achar o PC: scripts/install.sh --firewall"
