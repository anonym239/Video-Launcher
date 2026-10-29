# Video Launcher

Ein werbefreier YouTube-Client, der komplett **auf deinem Handy** läuft. Er braucht keinen API-Key, keinen fremden Server und keine KI. Ein kleiner Node.js-Server in Termux holt die Inhalte direkt von YouTube. Die Oberfläche öffnest du im Browser des Handys. Sie ist der YouTube-App bzw. youtube.com nachgebaut.

> Hinweis: Das Projekt ist nicht mit YouTube/Google verbunden. Das Logo ist ein eigenes Symbol. Werbefreies Abspielen über Drittanbieter-Clients widerspricht den YouTube-Nutzungsbedingungen. Die Nutzung erfolgt auf eigene Verantwortung und nur für private Zwecke.

## Funktionen

- **Startseite** mit Kategorie-Chips, Endlos-Scrollen und Shorts-Regal
- **Suche** mit Live-Vorschlägen, Suchverlauf, Sprachsuche und allen Filtern (Datum, Typ, Dauer, Merkmale, Sortierung). Eingefügte YouTube-Links werden direkt geöffnet.
- **Wiedergabeseite** wie bei YouTube:
  - Player mit eigener Steuerung: Qualität (bis 4K über DASH), Geschwindigkeit, Untertitel, Audiospuren und Schleife
  - Kapitel in der Fortschrittsleiste, „Meistgesehen“-Kurve und Vorschaubilder beim Spulen
  - Doppeltippen zum Spulen (±10 s), Gedrückthalten für 2-fache Geschwindigkeit
  - Vollbild, Bild-in-Bild, Kinomodus, Autoplay mit „Nächstes Video“-Countdown, Tastenkürzel
  - Steuerung über Sperrbildschirm und Benachrichtigung (Media Session)
  - Fortsetzen an der letzten Position
  - Mag ich / Mag ich nicht, Teilen, Speichern in Playlists, Herunterladen (Video oder nur Audio)
  - Beschreibung mit klickbaren Zeitstempeln, Kommentare mit Antworten und Sortierung, ähnliche Videos
  - Playlist-Panel mit Zufallsmix und Wiederholen
- **Miniplayer**: Beim Verlassen eines Videos läuft es unten weiter.
- **Shorts**: vertikal wischen, Endlos-Feed, Schleife, Liken, Kommentare, Teilen, Abonnieren
- **Kanäle**: Banner, Abonnieren (inkl. Glocke), Tabs für Startseite, Videos, Shorts, Live, Playlists und Beiträge, Kanalsuche und Kanalinfo
- **Abos, Verlauf, Playlists, Später ansehen, Mag ich**:
  - mit Anmeldung über dein YouTube-Konto
  - ohne Anmeldung lokal auf dem Handy; den Abo-Feed holt die App dann über die öffentlichen RSS-Feeds der Kanäle
- **Benachrichtigungen** (wenn angemeldet), Hashtag-Seiten, Trends
- „Kein Interesse“ und „Kanal nicht empfehlen“, Wiedergabeverlauf pausieren oder löschen, Backup exportieren und importieren
- Dunkles, helles oder Gerätedesign; Layout für Handy, Tablet und Desktop
- **Keine Werbung**: Werbeblöcke, gesponserte Inhalte und Shopping-Elemente werden herausgefiltert. Die Videos kommen ohne Werbeclips.

## Installation auf dem Handy (Android + Termux)

1. **Termux** aus F-Droid installieren (die Play-Store-Version ist veraltet).
2. In Termux:
   ```bash
   pkg install -y git
   git clone https://github.com/anonym239/Video-Launcher.git
   cd Video-Launcher
   bash scripts/termux-install.sh
   ```
3. Starten:
   ```bash
   bash scripts/start.sh
   ```
4. Im Browser des Handys **http://localhost:8080** öffnen. Über „Zum Startbildschirm hinzufügen“ wird daraus eine App-Kachel.

Weitere Optionen:
- `bash scripts/start.sh --lan` – auch für andere Geräte im WLAN erreichbar (z. B. Tablet, Fernseher)
- `PORT=9000 bash scripts/start.sh` – anderer Port

Alle Daten (Abos, Verlauf, Playlists, Login-Schlüssel) liegen im Ordner `data/` auf dem Handy.

## Mit dem eigenen Konto anmelden

Oben rechts auf **Anmelden** tippen und **Mit Google anmelden** wählen. Es erscheint ein Code:

1. Öffne google.com/device (auf dem Handy oder einem anderen Gerät).
2. Gib den Code ein und bestätige mit deinem Google-Konto, ganz normal auf der offiziellen Google-Seite.
3. Fertig. Abos, Playlists, „Mag ich“, Verlauf, Kommentare und Empfehlungen kommen jetzt aus deinem Konto.

Dein Passwort wird **nie** in diese App eingegeben. Auf dem Handy wird nur der Zugangsschlüssel gespeichert. „Abmelden“ löscht ihn wieder.

Alternative für Fortgeschrittene: Unter *Anmelden → Mit Browser-Cookies anmelden* den Cookie-Header von youtube.com einfügen.

## Wenn ein Video nicht lädt

YouTube ändert regelmäßig seine Schnittstellen.
- Aktualisieren: `git pull && npm install`
- Ausweichlösung: `pip install -U yt-dlp` installieren. Die App nutzt yt-dlp automatisch, wenn die eingebaute Methode scheitert.
- Unter *Einstellungen → Erweitert* lässt sich die Reihenfolge der Abruf-Clients ändern.

## Entwicklung

```bash
npm install
npm start          # http://localhost:8080
npm test           # Server- und Parser-Tests
```

Aufbau:
- `server/` – Node.js-Server ohne Framework
  - `yt.js`: Sitzung und Anmeldung (youtubei.js)
  - `api.js`: Endpunkte
  - `normalize.js`: Umwandlung der Daten und Werbefilter
  - `stream.js`: Streams, DASH-Manifest und Video-Proxy
  - `rss.js`: lokaler Abo-Feed
  - `store.js`: lokale Daten
- `public/` – Oberfläche ohne Build-Schritt (ES-Module)
  - `player.js`: Videoplayer mit Shaka
  - `pages/`: die einzelnen Seiten

Sicherheit: Der Server lauscht standardmäßig nur auf `127.0.0.1`. Er prüft den Host-Header (Schutz vor DNS-Rebinding), verlangt für schreibende Anfragen einen eigenen Header (CSRF-Schutz) und leitet über den Proxy nur YouTube-Videoserver weiter.
