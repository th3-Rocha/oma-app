#!/usr/bin/env bash
# desc: Abre o Gmail no navegador padrão
# Lançado pelo Hyprland, para a janela não morrer junto com o serviço do oma-app.
hyprctl dispatch 'hl.dsp.exec_cmd("omarchy-launch-browser https://mail.google.com")'
