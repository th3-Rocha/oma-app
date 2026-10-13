#!/usr/bin/env bash
# Runs the backend from source on another port, next to the installed service.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OMA_PORT="${OMA_PORT:-43659}" OMA_SOUNDS_DIR="$ROOT/sounds" exec dotnet run --project "$ROOT/backend/Oma.Server.csproj"
