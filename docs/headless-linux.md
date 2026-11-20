# Autark ohne Fenster auf Linux (Headless)

Autark kann auf Linux **ohne Bildschirm** laufen – als Hintergrunddienst. Du bedienst es dann im **Browser** oder mit
dem **Handy**. Das passt für zwei Fälle:

- **Linux-Server** (kein Bildschirm, kein X/Wayland): Autark läuft als Systemdienst mit eigenem Benutzer `autark`.
- **Linux-Desktop**: Autark läuft als Dienst deines eigenen Benutzers im Hintergrund. Ein Fenster brauchst du nicht.

Im Headless-Modus startet nur der Kern von Autark (die „Runtime“). Dafür nutzt Autark sein eigenes Programm im
reinen Node-Modus (`ELECTRON_RUN_AS_NODE=1`). Es braucht keinen Bildschirm, keine Grafikkarte und kein X/Wayland.

> **Wichtig:** Der Headless-Dienst hat **eigene Daten**. Er benutzt nicht den Datenordner der Desktop-App
> (`~/.config/Autark`). Grund: Die Desktop-App schützt ihre Geheimnisse (z. B. API-Schlüssel) mit dem Schlüsselbund
> des Systems, der Headless-Dienst mit einer Schlüsseldatei. Und zwei Autark auf denselben Daten würden sich stören.

## 1. Installieren

Du brauchst: Linux mit **x86_64 (x64)** oder **aarch64 (arm64)**, `tar` und **systemd**. Getestet auf Debian 12,
Ubuntu 22.04 und 24.04 (x64); arm64 (Raspberry Pi 4/5, Ampere, Graviton) startet aus demselben Paket.

### Server (Systemdienst)

```bash
curl -fsSL https://raw.githubusercontent.com/desquerteur/Autark-Plus/main/scripts/install-headless.sh | sudo bash
```

**Frisches Debian / Proxmox-LXC (als root, ohne curl und sudo):** ein minimales Debian hat weder `curl` noch `wget`
noch `sudo`. Dann als root:

```bash
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/desquerteur/Autark-Plus/main/scripts/install-headless.sh | bash -s -- --server
```

Das Skript selbst braucht danach nichts weiter: fehlt beim Download `curl`, nimmt es `wget` oder installiert `curl`.
In einem **Proxmox-LXC** ohne „Nesting“ verweigert systemd die Sandbox des Dienstes (Fehler `226/NAMESPACE`); das
Skript erkennt das und startet den Dienst dann ohne `PrivateTmp`/`ProtectSystem`
(`/etc/systemd/system/autark.service.d/container.conf`). Besser: im Container unter *Optionen → Features* **nesting**
einschalten, dann läuft er mit voller Sandbox.

**Eigener Spiegel / offline:** `AUTARK_DOWNLOAD_BASE=http://server/autark/0.3.9/ … | bash -s -- --version v0.3.9`
nimmt die Release-Dateien (`autark-linux-<arch>.tar.gz`, `SHA256SUMS.txt`) aus diesem Ordner statt von GitHub.

Das Skript

1. lädt die neueste Linux-Version aus den Releases von `desquerteur/Autark-Plus`
   (`autark-linux-x64.tar.gz`, sonst `autark-linux-x64.AppImage`; auf arm64 `autark-linux-arm64.tar.gz`) und prüft
   die Prüfsumme, wenn das Release eine `SHA256SUMS.txt` hat,
2. installiert fehlende System-Bibliotheken (apt, dnf, zypper oder pacman),
3. legt den Benutzer `autark` an,
4. legt diese Ordner an:

   | Was | Wo |
   | --- | --- |
   | Programm | `/opt/autark/releases/<version>`, aktiv: `/opt/autark/current` |
   | Daten | `/var/lib/autark` (nur für den Benutzer `autark` lesbar) |
   | Einstellungen | `/etc/autark/autark.env` |
   | Befehl | `/usr/local/bin/autark-headless` |
   | Dienst | `/etc/systemd/system/autark.service` |

5. startet den Dienst `autark` und zeigt dir gleich einen **Kopplungslink und Code** (siehe unten).

Standard beim Server: Autark ist im **lokalen Netz** erreichbar (`--bind lan`) auf Port **47811**.

### Desktop (Dienst deines Benutzers)

```bash
curl -fsSL https://raw.githubusercontent.com/desquerteur/Autark-Plus/main/scripts/install-headless.sh | bash
```

Ohne `sudo`. Alles landet in deinem Benutzerordner:

| Was | Wo |
| --- | --- |
| Programm | `~/.local/opt/autark/current` |
| Daten | `~/.local/share/autark` |
| Einstellungen | `~/.config/autark/autark.env` |
| Befehl | `~/.local/bin/autark-headless` |
| Dienst | `~/.config/systemd/user/autark.service` (`systemctl --user`) |

Standard beim Desktop: nur **dieser Computer** kommt an Autark heran (`--bind localhost`).
Soll Autark auch weiterlaufen, wenn du dich abmeldest, hänge `--linger` an:

```bash
curl -fsSL …/install-headless.sh | bash -s -- --linger
```

Fehlen System-Bibliotheken, sagt das Skript, welche – installiere sie mit `sudo` und starte das Skript noch einmal.

### Optionen

Optionen kommen hinter `bash -s --`, z. B. `… | sudo bash -s -- --bind tailscale`.

| Option | Bedeutung |
| --- | --- |
| `--server` / `--desktop` | Art der Installation (Standard: Server mit `sudo`, sonst Desktop) |
| `--bind localhost\|lan\|tailscale` | wer an Autark herankommt: nur dieser Computer / das lokale Netz / dein Tailscale-Netz |
| `--port N` | Port der Weboberfläche (Standard 47811) |
| `--version v0.3.6` | eine bestimmte Version statt der neuesten |
| `--repo besitzer/name` | andere Release-Quelle (Standard `desquerteur/Autark-Plus`) |
| `--file PFAD` | eine schon heruntergeladene `.tar.gz` oder `.AppImage` installieren (ohne Download) |
| `--no-deps` | keine System-Bibliotheken installieren |
| `--no-start` | einrichten, aber nicht starten |
| `--linger` | Desktop: nach dem Abmelden weiterlaufen |
| `--update` | auf die neueste Version aktualisieren |
| `--uninstall` / `--purge` | entfernen / zusätzlich alle Daten löschen |

Das Skript kannst du gefahrlos mehrmals laufen lassen. Es richtet dann alles neu ein und lässt deine Daten und deine
Einstellungen in `autark.env` in Ruhe (außer du gibst `--bind` oder `--port` neu an).

## 2. Koppeln (Browser oder Handy verbinden)

Beim ersten Start – solange noch kein Gerät gekoppelt ist – schreibt Autark einen **Kopplungslink** und einen
**6-stelligen Code** in die Konsole bzw. ins Log. Das Installationsskript zeigt dir beides direkt an:

```
Pair a phone or browser (works once, for 10 minutes):
  Link:  http://192.168.1.20:47811/#pair=…
  Code:  123 456   (type it into the installed Autark app on the phone)
```

- **Browser:** den Link öffnen. Danach hat dieser Browser vollen Zugriff auf Autark.
- **Handy-App:** den Code in der installierten Autark-App eintippen.
- Link und Code gelten **10 Minuten** und funktionieren **einmal**.

Einen neuen Code bekommst du jederzeit mit:

```bash
autark-headless pair
```

Passt die Adresse im Link nicht (z. B. hat der Server mehrere Netzwerke), ersetze den Teil `http://…:47811` durch
eine der Adressen aus der Zeile `Web:` im Log.

Bei `--bind localhost` kann nur ein Browser **auf demselben Computer** den Link öffnen (`http://localhost:47811/#pair=…`).
Vom Handy aus geht es dann über die Autark-App und den Treffpunkt-Server (Remote ID), oder du stellst auf `lan` bzw.
`tailscale` um.

Gekoppelte Geräte siehst und entfernst du in der Weboberfläche unter **Einstellungen › Geräte**.

**Sicherheit:** Im lokalen Netz läuft die Verbindung über unverschlüsseltes HTTP. Für den Zugriff von unterwegs nimm
besser **Tailscale** (`--bind tailscale`, ggf. `tailscale serve` für https) statt Port 47811 ins Internet zu öffnen.
Eine Firewall (z. B. `ufw`) musst du selbst freigeben, falls nötig: `sudo ufw allow 47811/tcp`.

## 3. Alltag: Status, Logs, Neustart

```bash
autark-headless status     # läuft der Dienst?
autark-headless logs       # Log live ansehen (Strg+C beendet nur die Anzeige)
autark-headless restart    # neu starten
autark-headless stop       # anhalten
autark-headless start      # starten
autark-headless version    # installierte Version
autark-headless wf …       # das wf-Kommandozeilen-Werkzeug gegen diesen Autark
```

Dahinter stecken die normalen systemd-Befehle: Server `systemctl status autark` / `journalctl -u autark -f`,
Desktop `systemctl --user status autark` / `journalctl --user -u autark -f`.
Zusätzlich schreibt Autark eigene Logdateien in den Datenordner (`/var/lib/autark/logs` bzw. `~/.local/share/autark/logs`).

Einstellungen wie `--bind` und `--port` stehen in `autark.env`:

```bash
AUTARK_ARGS="--bind lan --port 47811"
```

Nach einer Änderung: `autark-headless restart`.

## 4. Aktualisieren

```bash
curl -fsSL https://raw.githubusercontent.com/desquerteur/Autark-Plus/main/scripts/install-headless.sh | sudo bash -s -- --update
```

(Desktop: ohne `sudo`.) Das Skript lädt die neueste Version, schaltet `current` um und startet den Dienst neu. Deine
Daten bleiben, wo sie sind. Die vorherige Version bleibt unter `releases/` liegen – zum Zurückgehen:
`--version v0.3.5`.

Die automatischen Updates der Desktop-App (Einstellungen › Updates, AF-019) gibt es im Headless-Modus **nicht** –
dort aktualisierst du mit `--update`.

## 5. Entfernen

```bash
curl -fsSL …/install-headless.sh | sudo bash -s -- --uninstall           # Programm und Dienst weg, Daten bleiben
curl -fsSL …/install-headless.sh | sudo bash -s -- --uninstall --purge   # zusätzlich alle Daten (und den Benutzer autark)
```

## 6. Ohne Skript starten

Mit der heruntergeladenen AppImage geht es auch von Hand:

```bash
./autark-linux-x64.AppImage --headless                  # Daten in ~/.local/share/autark
./autark-linux-x64.AppImage --headless --bind lan --data /pfad/zu/daten
./autark-linux-x64.AppImage --headless pair             # neuer Code für den laufenden Autark
```

Dabei startet das Programm sich selbst im Node-Modus neu. Klappt das auf einem Server nicht (z. B. Fehler zur
„Sandbox“ oder fehlende Bibliotheken), nimm den Weg ohne Electron-Oberfläche:

```bash
./autark-linux-x64.AppImage --appimage-extract          # entpackt nach ./squashfs-root (braucht kein FUSE)
ELECTRON_RUN_AS_NODE=1 ./squashfs-root/autark ./squashfs-root/resources/app.asar/app/runtime-cli.mjs --headless
```

Alle Optionen von `--headless`:

| Option | Bedeutung |
| --- | --- |
| `--data ORDNER` | Datenordner (Standard Linux: `~/.local/share/autark`) |
| `--bind localhost\|lan\|tailscale` | wer herankommt (ohne Angabe: die gespeicherte Wahl; ganz neu: das lokale Netz) |
| `--port N` | Port (Standard 47811; ist er belegt, nimmt Autark den nächsten freien) |
| `--no-pair` | beim Start keinen Kopplungslink ausgeben |
| `--log` | das Autark-Log zusätzlich in der Konsole zeigen |

Läuft auf demselben Datenordner schon ein Autark, beendet sich ein zweiter Start mit Code **3** („already runs“).

## 7. Linux-Paket bauen (für Releases)

In `apps/desktop/package.json` (`build.linux`) sind zwei Ziele eingetragen:

- `AppImage` für x64 → `autark-linux-x64.AppImage` (wie bisher, für die Desktop-Updates),
- `tar.gz` für x64 und arm64 → `autark-linux-x64.tar.gz`, `autark-linux-arm64.tar.gz` (für Server).

Bauen auf Linux:

```bash
cd apps/desktop
npm ci
npm run build
npx electron-builder --linux --publish never
```

Die Dateien landen in `apps/desktop/dist/`. Lade sie zusammen mit einer `SHA256SUMS.txt`
(`sha256sum autark-linux-* > SHA256SUMS.txt`) ins Release hoch.

**Auf Windows bauen:** Das `tar.gz` lässt sich auf Windows bauen
(`npx electron-builder --linux tar.gz --x64 --publish never`, dauert gut 10 Minuten). Zwei Haken:

- Im Paket fehlen die Unix-Ausführungsrechte (`autark` ist nicht als ausführbar markiert). Das Installationsskript
  setzt sie selbst; wer von Hand entpackt, macht `chmod +x autark`.
- Statt des Linux-Sprachmoduls (`sherpa-onnx-linux-x64`) liegt das Windows-Modul darin, weil npm auf Windows nur die
  Windows-Variante installiert. Die lokale Spracherkennung geht in so einem Paket nicht.

Das **AppImage** lässt sich auf Windows **nicht** bauen (electron-builder braucht dafür symbolische Links, Fehler
`EPERM … symlink`). Für ein vollständiges Release also auf Linux bauen.

## Was nur auf echtem Linux geprüft werden kann

Auf Windows getestet sind: der Headless-Start (Runtime ohne Fenster, Kopplungslink und Code, `pair`, Code einlösen,
Sperre gegen einen zweiten Start), die vom Skript erzeugten Dateien und `bash -n`. Nur auf Linux prüfbar sind:
Download aus dem Release, Entpacken, System-Bibliotheken, der systemd-Dienst, `autark-headless` als Benutzer `autark`
und `--update`/`--uninstall`.
