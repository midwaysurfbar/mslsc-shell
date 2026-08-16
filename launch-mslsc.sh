#!/usr/bin/env bash
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

# Double-clicking a .desktop file launches with a much barer environment
# than an interactive terminal - it does NOT source .bashrc, so an
# nvm-installed Node.js is invisible to it (PATH falls back to whatever
# system Node exists at /usr/bin, if any, which may be a different,
# older version than what this app was actually built against). Load
# nvm explicitly so this behaves the same whether double-clicked or run
# from a terminal.
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi

echo "============================================================"
echo "  MSLSC Systems Shell - Phase 1 prototype"
echo "============================================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed on this machine, and this needs it to run."
  echo "Install it from https://nodejs.org/en/download (LTS version), then"
  echo "run this script again."
  read -rp "Press Enter to close..."
  exit 1
fi

# Checks for the actual Electron binary, not just the node_modules
# folder - npm install can finish "successfully" while the separate
# download of Electron's own binary silently fails partway through
# (seen for real on a venue PC's network), leaving a node_modules
# folder that exists but doesn't actually work. Re-installing from
# scratch clears that up automatically.
if [ ! -x "node_modules/electron/dist/electron" ]; then
  if [ -d "node_modules" ]; then
    echo "A previous install looks incomplete - reinstalling from scratch..."
    rm -rf "node_modules"
    echo
  fi
  echo "First run - installing dependencies, this only happens once and"
  echo "may take a minute..."
  echo
  npm install
  if [ ! -x "node_modules/electron/dist/electron" ]; then
    echo
    echo "Dependencies installed, but Electron's own program file still"
    echo "didn't download correctly - this usually means the network"
    echo "here is blocking or timing out on that specific download"
    echo "(it's separate from the regular install). Try again on a"
    echo "different network if this keeps happening."
    read -rp "Press Enter to close..."
    exit 1
  fi
  echo
fi

echo "Starting MSLSC..."
npm start

echo
echo "MSLSC has closed."
read -rp "Press Enter to close this window..."
