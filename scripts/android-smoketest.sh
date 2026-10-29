#!/usr/bin/env bash
# Startet die APK im Emulator und prüft, ob App und Server laufen.
# Wird von .github/workflows/android.yml ausgeführt.
set -u
PKG=de.videolauncher.app
APK=${1:-dist/VideoLauncher.apk}
OUT=smoketest
mkdir -p "$OUT"

adb wait-for-device
adb install -r "$APK" || { echo "::error::Installation fehlgeschlagen"; exit 1; }
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS 2>/dev/null || true
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity

ok=0
for i in $(seq 1 60); do
  sleep 2
  adb forward tcp:8723 tcp:8723 >/dev/null 2>&1
  if curl -sf -m 3 http://127.0.0.1:8723/api/status > "$OUT/status.json"; then ok=1; break; fi
done

echo "===== Prozesse ====="
APP_PID=$(adb shell pidof $PKG | tr -d '\r')
NODE_PID=$(adb shell pidof $PKG:node | tr -d '\r')
echo "App-Prozess: ${APP_PID:-FEHLT}"
echo "Node-Prozess: ${NODE_PID:-FEHLT}"

echo "===== Server ====="
if [ $ok = 1 ]; then
  echo "Server antwortet: $(cat "$OUT/status.json" | head -c 300)"
  echo "--- Startseite (YouTube-Abruf vom Emulator aus) ---"
  curl -s -m 60 "http://127.0.0.1:8723/api/home" | head -c 1500; echo
  VID=$(curl -s -m 60 "http://127.0.0.1:8723/api/home" | grep -o '"type":"video","id":"[A-Za-z0-9_-]\{11\}"' | head -1 | grep -o '[A-Za-z0-9_-]\{11\}"$' | tr -d '"')
  if [ -n "$VID" ]; then
    echo "--- Streams für $VID ---"
    curl -s -m 90 "http://127.0.0.1:8723/api/streams/$VID" | head -c 1500; echo
  fi
else
  echo "::error::Server antwortet nicht"
fi

sleep 5
adb exec-out screencap -p > "$OUT/screen.png" || true
adb logcat -d > "$OUT/logcat.txt"
echo "===== Logcat (Auszug) ====="
grep -E "VideoLauncher|AndroidRuntime|FATAL|libc |DEBUG  |linker|UnsatisfiedLink|$PKG" "$OUT/logcat.txt" | grep -v "chatty" | tail -150

if [ -z "$APP_PID" ] || [ $ok != 1 ]; then
  echo "::error::Smoke-Test fehlgeschlagen (App läuft: ${APP_PID:-nein}, Server: $ok)"
  exit 1
fi
echo "✔ Smoke-Test bestanden"
