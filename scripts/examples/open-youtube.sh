#!/usr/bin/env bash
# desc: Abre o YouTube no navegador padrão
# Lançado pelo Hyprland, para a janela não morrer junto com o serviço do oma-app.
hyprctl dispatch 'hl.dsp.exec_cmd("omarchy-launch-browser https://www.youtube.com")'
