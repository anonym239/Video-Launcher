# Video Launcher

Ein werbefreier Video-Client für YouTube-Inhalte, der komplett **auf deinem Handy** läuft. Er braucht keinen API-Key, keinen fremden Server und keine KI. Es gibt ihn als **Android-App (APK)** oder zum Selbststarten in Termux. Die Oberfläche ist der YouTube-App bzw. youtube.com nachempfunden.

> Unabhängiges Open-Source-Projekt, **nicht mit YouTube oder Google verbunden**. Siehe [Rechtliches](#rechtliches).

## App installieren

Es gibt **eine einzige Datei**. Du musst nichts anderes installieren.

1. Auf dem Handy **[VideoLauncher.apk](https://github.com/anonym239/Video-Launcher/releases/latest/download/VideoLauncher.apk)** herunterladen.
2. Datei öffnen → **Installieren**. Beim ersten Mal fragt Android, ob Installationen aus dieser Quelle erlaubt sind → erlauben.
3. App öffnen – fertig.

Alles steckt in der App, auch der Server. Termux, Node.js oder andere Programme brauchst du nicht. Die APK wird bei jedem Push automatisch von GitHub gebaut.

In der App:
- YouTube-Links lassen sich über „Teilen“ oder „Öffnen mit“ direkt an Video Launcher schicken.
- Videos laufen im Hintergrund weiter. Beim Verlassen der App erscheint Bild-im-Bild.
- Downloads landen im Download-Ordner.

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
- **Abos, Verlauf, Playlists, Später ansehen, Mag ich** aus deinem YouTube-Konto (Anmeldung ist Pflicht)
- **Benachrichtigungen** (wenn angemeldet), Hashtag-Seiten, Trends
- „Kein Interesse“ und „Kanal nicht empfehlen“, Wiedergabeverlauf pausieren oder löschen, Backup exportieren und importieren
- Dunkles, helles oder Gerätedesign; Layout für Handy, Tablet und Desktop
- **Keine Werbung**: Werbeblöcke, gesponserte Inhalte und Shopping-Elemente werden herausgefiltert. Die Videos kommen ohne Werbeclips.
- **Endlos schauen**: Startseite und „Ähnliche Videos“ enden nie. Wenn YouTube keine weiteren Seiten liefert, lädt die App immer neue Videos aus den Empfehlungen der zuletzt gezeigten Videos und aus deinem Verlauf. Autoplay spielt immer das nächste Video ab.

## Für Entwickler: ohne App in Termux starten

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

Beim Start erscheint die Anmeldeseite – ohne Anmeldung lässt sich die App nicht benutzen.

**Android-App:** **Mit Google anmelden** tippen. Es öffnet sich die offizielle Google-Anmeldeseite. Nach der Anmeldung übernimmt die App die YouTube-Sitzung automatisch. Fertig: Abos, Playlists, „Mag ich“, Verlauf, Kommentare und Empfehlungen kommen jetzt aus deinem Konto.

Dein Passwort wird **nie** an diese App gegeben – es wird nur auf der Google-Seite eingegeben. Auf dem Handy wird nur die YouTube-Sitzung gespeichert. „Abmelden“ löscht sie wieder.

**Im Browser (Termux):** Unter *Mit Browser-Cookies anmelden* den Cookie-Header von youtube.com einfügen.

> Warum nicht über GmsCore/microG-Konten? GmsCore gibt YouTube-Zugangsschlüssel nur an Apps heraus, die sich als die offizielle YouTube-App ausweisen (so funktioniert ReVanced: Es *ist* die gepatchte YouTube-App). Eine eigene App bekommt dort keinen gültigen Schlüssel. Die frühere Anmeldung per Code über google.com/device lässt YouTube nicht mehr zu – deshalb schlug sie immer fehl.

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

## Android-App selbst bauen

```bash
npm ci
node scripts/prepare-android.mjs   # lädt Node.js für Android (nodejs-mobile) und packt den Server
cd android && ./gradlew assembleRelease
```

Benötigt JDK 17 und das Android SDK mit NDK 27. Für Updates ohne Neuinstallation sollte jede Version mit demselben Schlüssel signiert sein. Lege dafür in GitHub unter *Settings → Secrets → Actions* `VL_KEYSTORE_BASE64`, `VL_KEYSTORE_PASSWORD`, `VL_KEY_ALIAS` und `VL_KEY_PASSWORD` an. Ohne diese Secrets nutzt der Build einen Schlüssel, der im Cache von GitHub Actions liegt. Er bleibt erhalten, solange regelmäßig gebaut wird.

## Rechtliches

**Kein Rechtsrat.** Eine Garantie, nie verklagt oder abgemahnt zu werden, kann niemand geben. Das Projekt folgt aber dem Muster, mit dem vergleichbare Open-Source-Apps wie NewPipe seit Jahren existieren:

- **Kein zentraler Server:** Jede Person führt die App auf dem eigenen Gerät aus. Der Projektbetreiber hostet, speichert und verbreitet keine Videos und leitet keinen Datenverkehr fremder Nutzer weiter.
- **Keine Marken von Google:** eigener Name, eigenes Logo. „YouTube“ wird nur genannt, um die Kompatibilität zu beschreiben. Der Hinweis „nicht verbunden mit YouTube/Google“ steht in App, README und LICENSE.
- **Kein Code von YouTube:** Es wird keine veränderte YouTube-App verteilt. Genau das hat 2022 zum Aus von „YouTube Vanced“ geführt.
- **Kein Geld, keine Datensammlung:** keine Werbung, kein Tracking, keine Konten auf einem Projektserver. Die Anmeldung erfolgt direkt bei Google.
- **Open Source** unter MIT-Lizenz mit Haftungsausschluss. Fremdlizenzen stehen in `THIRD_PARTY_NOTICES.md`.

Wichtig für dich als Betreiber:
- Betreibe **keine öffentliche Instanz** im Internet, bei der fremde Leute über deinen Server schauen. Betreiber öffentlicher Invidious-Instanzen haben 2023 Post von YouTubes Rechtsabteilung bekommen. Der Modus `--lan` ist nur für das eigene Heimnetz gedacht.
- Werbe nicht mit „YouTube“ im Namen und nutze kein YouTube-Logo.
- Veröffentliche die App nicht im Google Play Store. Google entfernt dort solche Apps; die Verbreitung über GitHub oder F-Droid ist üblich.
- Werbefreies Abspielen und Herunterladen widerspricht den Nutzungsbedingungen von YouTube. Das betrifft in erster Linie die einzelnen Nutzer (Risiko etwa: Sperrung des Kontos). Herunterladen nur für den privaten Gebrauch und nur, wo das Urheberrecht es erlaubt.
- Wenn du das Projekt groß verbreiten oder damit Geld verdienen willst, lass dich vorher von einer Anwältin oder einem Anwalt für IT- und Urheberrecht beraten.
