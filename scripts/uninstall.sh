#!/usr/bin/env bash
# Stops and removes the service and the installed binaries. Config and paired devices are kept.
set -euo pipefail
systemctl --user disable --now oma-app.service 2>/dev/null || true
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/oma-app.service"
systemctl --user daemon-reload
if command -v omarchy >/dev/null; then
  omarchy plugin disable rocha.oma-app 2>/dev/null || true
  rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins/rocha.oma-app"
fi
rm -rf "$HOME/.local/share/oma-app/server"
echo "Removido. Configuração mantida em ${XDG_CONFIG_HOME:-$HOME/.config}/oma-app"
