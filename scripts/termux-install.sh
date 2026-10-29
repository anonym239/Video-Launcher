#!/data/data/com.termux/files/usr/bin/bash
# Installiert Video Launcher in Termux (Android). Aufruf im Projektordner:
#   bash scripts/termux-install.sh
set -e

echo "▶ Pakete installieren (Node.js, Git) …"
pkg update -y
pkg install -y nodejs-lts git

echo "▶ Abhängigkeiten installieren …"
cd "$(dirname "$0")/.."
npm install --omit=dev

read -r -p "Optional yt-dlp als Ausweichlösung installieren? (empfohlen) [J/n] " answer
if [ -z "$answer" ] || [ "$answer" = "j" ] || [ "$answer" = "J" ] || [ "$answer" = "y" ]; then
  pkg install -y python
  pip install -U yt-dlp
fi

echo ""
echo "✔ Fertig. Starten mit:  bash scripts/start.sh"
echo "  Danach im Browser öffnen: http://localhost:8080"
