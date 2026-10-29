#!/usr/bin/env bash
# Startet den Server. In Termux wird ein Wake-Lock gesetzt, damit Android den
# Server bei ausgeschaltetem Bildschirm nicht beendet.
cd "$(dirname "$0")/.."
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi
exec node server/index.js "$@"
