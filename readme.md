# ⚡ oma-app | Remote System Controller

**oma-app** is a custom-built, monolithic remote control solution designed specifically for the **Omarchy** setup (Arch Linux + Hyprland). It allows you to control your workstation directly from your mobile device with zero friction.

## 🛠 Tech Stack

- **Backend:** ASP.NET Core 8 (C#) - Acting as the system bridge.
- **Mobile:** React Native (Expo) - The command center.
- **Communication:** SignalR (WebSockets) for real-time terminal output and REST for triggers.
- **Styling:** Custom Omarchy UI with system-matching fonts and terminal aesthetics.

## ✨ Key Features

- **Wake-on-LAN (WoL):** Boot your machine directly from the app.
- **Hyprland Integration:** Use `hyprctl` to switch workspaces, move windows, or toggle layouts remotely.
- **Script Launcher:** One-tap buttons to trigger complex `.sh` scripts (Work Mode, Study Italian, Media Controls).
- **Embedded Terminal:** A functional mobile terminal to run shell commands on the fly.
- **Live Status:** Real-time monitoring of system processes and open windows.

## 🎨 Aesthetic & UI
The frontend is designed to be an extension of the **Omarchy** desktop experience:
- **Typography:** Uses the same monospace fonts as the Arch terminal.
- **Terminal UI:** Retro-modern terminal component with syntax highlighting.
- **Themes:** Dark mode by default, following the Hyprland/Waybar color palette.

## 📂 Structure

```text
/oma-app
├── /backend          # ASP.NET Core API (The "Brain")
├── /mobile           # Expo App (The "Remote")
└── /scripts          # Custom Arch Linux automation scripts
