# Autark für Android (0.3.6, 08.11.2026; Play-Vorbereitung 07.11.2026)

Die Android-App verbindet sich über **Autarks Treffpunkt** (`wss://telecoding-relay.onrender.com/autark`) mit den PCs der eigenen Firma – kein Tailscale, kein VPN, keine erreichbare PC-Adresse. Agenten, Modelle und Daten bleiben auf den PCs; die App zeigt die **unveränderte Handy-Oberfläche** des PCs, ohne eigene Werkzeugleiste.

## Verbinden (eine Kopplung wie zwischen PCs)

1. Auf dem PC: **Settings → Devices → Connect a phone** zeigt die **Remote ID** und einen QR-Code, der nur sie trägt (`https://openautark.com/pair/#<ID>`, ältere PCs `https://metajarvis.teydralab.com/autark/pair/#<ID>`; ohne App zeigt die Seite der Website die ID und die Downloads; ältere QR-Codes ohne `/` vor `#` liest die App weiter).
2. In der App (B-084, eigene native Ebenen in `pair/`): **Connect to your PC** → **Scan QR code** öffnet den Scanner in voller Höhe (Camera2 + ZXing core 3.5.3, `QrDecode`); unten eine feste Leiste mit den neuesten Fotos/Screenshots (Website-APK, Fotorecht erst beim Öffnen des Scanners gefragt; Play-Build: System-Fotoauswahl) und **Files** – ein Tipp auf ein Bild liest dessen QR-Code. Oder **Enter the code instead**: Feld für die 9 Ziffern (3-3-3), **Connect**. Ein fremder QR-Code wird gemeldet, der Scanner läuft weiter. Ein Pair-Link (App Links, sobald `assetlinks.json` steht) öffnet direkt das Code-Feld, ausgefüllt.
3. Beide Bildschirme zeigen denselben 4-stelligen Code; auf dem PC erscheint „Phone <Modell> asks to connect“ → **Accept**.
4. Danach öffnet sich die Handy-Oberfläche. Beim nächsten Start verbindet die App von selbst – mit dem ersten PC der Firma, der online ist (die Liste kommt über `phoneUse.attach`; die anderen PCs kennen das Handy über den Roster). Welcher PC: Profilblatt → Statuszeile „<Firma> · <PC>“ → PC-Auswahl (verbunden / online / offline; die Wahl kommt nach vorn).
5. Entfernen: auf dem PC das Handy unter Devices entfernen (auf allen PCs) und/oder in der App **Forget this phone** – entfernt nur die aktuelle Firma (ihren Speicher und ihr Gate-Cookie), danach die nächste Firma oder der Verbinden-Bildschirm.

## Mehrere Firmen

`Companies` (Prefs `companies`) hält eine Kopplung je Firma; die alte Einzel-Kopplung von 0.3.x wird einmalig zu `c1` auf Port 47920 (Speicher und Anmeldung bleiben). Jede weitere Firma bekommt einen eigenen festen Port 47920+n = eigener Origin, also eigener Web-Speicher. Eine neue Kopplung mit einem schon bekannten PC ersetzt die Daten dieser Firma. Im Profilblatt der Handy-Oberfläche: Firmen mit Bild (Firmenkarte der Seite oder Initialen), aktuelle mit Haken, **Add a company** (dieselben Kopplungs-Ebenen, Zurück kehrt zur aktuellen Firma zurück). Ein Pair-Link, während das Handy schon gekoppelt ist, startet ebenfalls „Add a company“. Beim Wechsel baut die App die Verbindung der alten Firma ab und die der neuen auf (`CompanyLink`).

## Verbindung halten

- Tote Verbindung in Sekunden statt Minuten: 15-s-Timeout schon im TLS-Handshake, Pings zählen als Verkehr, `probe()` (Ping, nach 2 s Stille weg), Backoff 0,5/1/2/5/10 s.
- Bei Rückkehr in die App (`onResume`) und bei jedem Netzwechsel (`relay/NetworkWake`, ACCESS_NETWORK_STATE) prüft die App die Verbindung sofort (`check()`); nach jeder neuen Verbindung hört die Seite `resume` und holt ihre Daten neu. Nach unten ziehen ganz oben lädt neu.
- `KeepAlive`: kleiner Vordergrunddienst (Typ remoteMessaging) mit einer leisen, festen Benachrichtigung „Connected to <PC>“ / „Reconnecting…“, solange das Handy gekoppelt ist – Verbindung und Benachrichtigungen laufen bei Display aus weiter. Endet mit dem Vergessen der letzten Firma.
- Absturz des WebView-Renderers: die App baut einen neuen WebView und öffnet dieselbe Stelle wieder. Hell/Dunkel-Wechsel baut die Activity neu auf; die aktuelle Stelle (`#/…`) bleibt.

## Seite ↔ App

Ein einziger Kanal: nach jedem Seitenladen bekommt die Seite einen `MessagePort` (`NativePort`, nur an den eigenen Origin, kein `addJavascriptInterface`). JSON `{t, …}`: App → Seite `companies`, `status`, `share`, `speechDone`, `saved`, `resume`; Seite → App `colors` (Leistenfarben, `SystemBars`), `card`, `switch`, `add`, `forget`, `pcs`, `speak`/`stopSpeech` (Handy-Stimme per TextToSpeech, `PhoneSpeech`, wenn der PC keine Stimme liefert), `download`, `haptic`. Medien spielen ohne zweiten Tipp (`setMediaPlaybackRequiresUserGesture(false)`, Anrufe).

## Benachrichtigungen, Teilen, Downloads

- **Benachrichtigungen** (ein WebView hat kein Web Push): die `notify`-Ereignisse des PCs, die `UseLink` hört, werden zu einer Benachrichtigung je Chat oder Aufgabe (`AppNotices`, Kanal „Messages“) – nur, wenn die App nicht offen ist; Öffnen der App räumt sie weg. Tipp öffnet den Chat (`#/chat/<id>`, sonst `#/day`). Ab Android 13 fragt die App einmal nach dem Recht. App-Shortcuts (lange drücken aufs Icon): Chats, Work, My day.
- **Teilen an Autark** (Text, Bilder, Dateien aus jeder App): die Seite hört `share {text, files}` und zeigt „Pick a chat“; der Text geht in den Entwurf, die nächste Dateiauswahl dieser Seite bekommt die geteilten Dateien (`ShareIn`, `PhoneChrome`; nach 10 min verfallen sie).
- **Downloads aufs Handy:** „Save to phone“ der Seite schickt die Bytes über den Port (≤ 25 MB) → `PhoneDownloads` legt sie in „Downloads“ ab (MediaStore ab Android 10, sonst App-Ordner), Toast „Saved to Downloads: <Name>“. Links auf `/files/<sha>` des eigenen Origins lädt die App direkt mit ihrem Cookie.

## Handy-Bedienung nachrüsten (Website-Lite)

Die Lite-APK der Website hat keinen Bedienungshilfen-Dienst (Play Protect blockiert seitlich geladene Apps damit hart). Will die KI das Handy bedienen, zeigt die App einmal je 10 min „Let the AI use this phone“; der Tipp öffnet einen Dialog, **Install** holt die Phone-Use-Version aus dem vollen Feed `latest-android.json` und installiert sie über Autarks eigenen Installer (`PhoneUseUpgrade` → `SelfUpdate`, Größe und SHA-256 geprüft) – kein Browser-/Dateimanager-Sideload. Ob Play Protect diesen Weg zulässt, ist auf dem S23 noch zu prüfen. Danach folgen wie immer Offenlegung und Bedienungshilfen-Schalter.

Kein „Phone access“-Schalter mehr: Zugang besteht genau, solange die akzeptierte Gerätezeile existiert. Die alte `phone`-Code-Nachricht (0.2.x/0.3.2-APK) beantworten neue PCs mit „Update the Autark app“.

## Zurück

Die Zurück-Geste ruft per `evaluateJavascript` `window.autarkBack()` (`ui/pwa/back.ts`): erst Dialoge, das globale Blatt, der Chat-Bereich, dann ein geöffneter Bildschirm, ein Einstellungsabschnitt, ein anderer Tab → Mein Tag. Liefert es `false` (Mein Tag), geht die App mit `moveTaskToBack(true)` in den Hintergrund – sie schließt sich nie selbst.

## Handy-Bedienung durch die KI (Phone use)

- **Offenlegung vor dem Einschalten (Google Play, ab 0.3.4):** `phoneuse/UseDisclosure` (Wortlaut `DisclosureText`, Deutsch/Englisch) zeigt in der App, was gelesen und getan wird, wohin es geht und wie man es stoppt; „Agree and continue“ speichert die Zustimmung (`UseConsent`) und öffnet erst dann die Bedienungshilfen-Einstellungen, „Not now“ nichts (ein von Hand eingeschalteter Dienst schaltet sich dann selbst ab). Ohne Zustimmung meldet die App dem PC nicht „ready“, führt keine Schritte aus und der Hinweis (`EnablePrompt`) führt zuerst zur Offenlegung. Auf einem echten Gerät noch nicht geprüft.
- `phoneuse/UseService`: AccessibilityService, liest nichts, bis der PC fragt (`res/xml/accessibility_service.xml`: nur `typeWindowStateChanged`, ignoriert). Schritte: `ui_tree` (`ScreenTree`, rein, Host-Test), `screenshot` (Android 11+), `tap` (ACTION_CLICK am Element, sonst kurzer Druck), `swipe` (gekrümmter, leicht verwackelter Pfad, `Gestures`), `type` (ACTION_SET_TEXT, Enter zwischen Zeilen), `key` (back/home/recents/notifications/quick_settings/enter), `open` (App oder Link).
- `UseBubble`: Blase oben (TYPE_ACCESSIBILITY_OVERLAY, keine Extra-Berechtigung) „Autark is using this phone · Tap to stop“ – Tippen bricht ab und pausiert 30 s; beim ersten Zugriff auf eine App fragt sie einmal „Let the AI use <App>?“ (`AppConsent`, gemerkt je Paket).
- `UseLink`: zweiter WebSocket der App zu `/ws` durch denselben lokalen Eingang (Gate-Cookie + Handy-Token), `phoneUse.attach` → hört `phoneUse.request` nur für dieses Gerät, antwortet mit `phoneUse.reply`. Ist die Bedienung aus, antwortet er `off` und zeigt `EnablePrompt` (Benachrichtigung „Let the AI use this phone“ → Bedienungshilfen; Hinweis auf „Allow restricted settings“ ab Android 13 bei Sideload).
- PC-Seite: `runtime/phone/app-driver.ts` (20 s je Schritt), `phone/drivers.ts` (ADB + App), `rpc/handlers/phone-use.ts`.
- iOS: keine App; Drittanbieter-Apps können iPhones nicht bedienen. Das iPhone nutzt die Web-App über Tailscale (Skill `phone-access`).

## Updates

Ab 0.3.6 (Owner 08.11. 14:35, Wortlaut `.local/android-036/OWNER-2026-11-08-1435.md`): `UpdateCheck` liest im Release-Build beim Start und bei Rückkehr höchstens alle 6 h `latest-android.json` (voll) bzw. `latest-android-lite.json` (Lite) aus dem neuesten OpenAutark-Release. Bei höherem `versionCode` steht **oben eine feste Zeile** (`UpdateBar`: Text, ein Knopf, ×, dünne Fortschrittslinie), auch beim nächsten Start offline (gemerkter Release). Der Knopf hängt am Weg (`UpdateRelease.route`, Host-Test):

- **Aus Google Play installiert** (Installer `com.android.vending`) oder Play-Build: öffnet Autark in Google Play (`market://details?id=…`, sonst play.google.com) – Play aktualisiert (Play-Richtlinie).
- **Website-APK** (Flavor `site`, `src/site/`): `SelfUpdate` holt einmal „Unbekannte Apps installieren“ für Autark (Einstellungen, danach geht es von selbst weiter), streamt die APK direkt in eine Android-Installationssitzung mit echter Prozentanzeige, prüft Größe und SHA-256 gegen den Feed, erst dann `commit`; Android fragt zur Bestätigung (ab Android 12 `USER_ACTION_NOT_REQUIRED` angefragt – Android entscheidet, ob es ohne Dialog geht). `UpdateReceiver` meldet Abbruch/Fehler in die Zeile („Try again“) und nach `MY_PACKAGE_REPLACED` eine Benachrichtigung „Autark … is installed · Tap to open“ (Android beendet die alte App beim Ersetzen).
- Feed ohne `sha256`/`bytes` (vor 0.3.6): öffnet die APK-Adresse im Browser wie bisher.

Der Play-Build (Flavor `play`, `src/play/`) hat weder `REQUEST_INSTALL_PACKAGES` noch Download-/Installationscode (`SelfUpdate`-Stub).

## Wie es funktioniert

- **Handy-Schlüssel:** eigener Ed25519-Geräteschlüssel (BouncyCastle, Android 8+), im privaten App-Speicher (kein Backup).
- **Koppeln:** `relay/RemotePair` – byte-gleich mit `remote/sas.ts` (Host-Test `test/RemotePairTest.java` mit Vektoren aus dem Desktop-Code): remote1 (Rolle `phone`, eigene Schlüssel), Commitment des PCs, remote2, Code, remote3 wartet auf Accept; die Annahme trägt das Geräte-Token (versiegelt über den Treffpunkt).
- **Verbinden:** Alle PCs der Firma pinnen das Handy am Treffpunkt; die App pinnt alle PCs und tunnelt zum ersten erreichbaren. Darüber läuft derselbe Pinned-Key-Handshake wie zwischen PCs; der Kanal trägt Byte-Ströme zum HTTP-Port der PC-Runtime. Der Treffpunkt sieht nur Chiffretext.
- **Oberfläche:** lokaler Eingang nur auf `127.0.0.1` (Port 47920 für die erste Firma, 47921 … für weitere), sicherer Kontext für Chromium; nur mit dem Gate-Cookie dieser App. Klartext-HTTP nur für `127.0.0.1`.
- **Systemleisten:** die Oberfläche bleibt unter Uhr/Akku und Gesten-Leiste frei; die beiden Streifen tragen die Kopf- bzw. Tableisten-Farbe der Seite (`SystemBars`, Icons hell/dunkel nach Helligkeit), Dunkelmodus über `values-night`.

## Dateien

- `relay/` (ohne Android, Host-JVM, außer `NetworkWake`): `Crypto`, `Json`, `WebSocketClient`, `RelayLink` (mehrere gepinnte PCs, `probe`), `Tunnel`, `PeerChannel`, `StreamProxy`, `RemotePair`, `PhonePairing`, `PhoneConnection`, `CodeChain` (Personen-Code), `NetworkWake`.
- `pair/`: `PairScreens` (Ebenen), `PairLook`, `ScanView`, `RecentStrip`, `CodeField`, `QrDecode`, `PairRun` (eine Kopplung).
- `phoneuse/`: `UseService`, `ScreenTree`, `Gestures`, `UseBubble`, `AppConsent`, `UseLink`, `EnablePrompt`.
- `MainActivity` (Firmen, Kopplung, Seite, Zurück, Lebenszyklus), `CompanyLink` (Verbindung der aktuellen Firma, PC-Auswahl), `Companies`, `PhoneWeb` (WebView-Einstellungen, Downloads, Origin vergessen), `NativePort`, `SystemBars`/`CssColor`, `PhoneSpeech`, `PhoneDownloads`, `AppNotices`/`PhoneRoutes`, `KeepAlive`, `ShareIn`, `PhoneUseUpgrade`, `OfflineScreen` („Can't reach“), `PhoneNavigation` (`autark-app:forget`, Renderer-Absturz), `PhoneChrome`, `ConnectionAddress`, `UpdateCheck`.

## Bauen und Tests

Stand 08.11.2026 (Android 0.3.6): **0.3.6 / versionCode 6**. Zwei Flavors (`site` = APKs der Website mit eigenem Updater, `play` = Bundles für Google Play), Tasks heißen deshalb `assembleSiteRelease`, `assembleSitePlayLite`, `bundlePlayRelease`, `bundlePlayPlayLite`, `assembleSiteDebug`; `build.ps1` kopiert die Ergebnisse wie bisher nach `app/build/outputs/apk/release/` und bricht ab, wenn einer Website-APK der Updater fehlt. Veröffentlichung ins aktuelle Latest-Release: `.local/release-2026-11-08-036-android/publish.py` (backup, prepare, upload, verify). Frühere Kandidaten 0.3.5 / versionCode 5 (unveröffentlicht). Lite nutzt `latest-android-lite.json` mit `channel: lite` und einer URL auf `autark-android-lite.apk`; Vollversion behält `latest-android.json`. Der Lite-Feed muss beim Veröffentlichen aus dem signierten Lite-Baurecord plus öffentlicher APK-URL entstehen. Ohne passenden Lite-Feed bietet Lite kein Vollversionsupdate an. `UpdateReleaseTest` prüft diese Trennung; Installation auf einem echten Handy bleibt eine eigene Abnahme. Die nachfolgenden Releaseangaben beschreiben den bisherigen Stand.

- **Debug:** `.\build.ps1` – Paket `com.teydralab.autark.android.preview`, mit dem Debug-Schlüssel signiert; installiert sich neben der Release-App.
- **Release:** `.\build.ps1 -Release` mit dem Schlüssel aus `new-release-key.ps1` (liegt außerhalb des Repos unter `%USERPROFILE%\.autark-release\android`) – Paket `com.teydralab.autark.android`, `versionCode 4` / `0.3.4` (veröffentlicht ist noch 0.3.3 / 3), veröffentlicht als `autark-android.apk` in `teydra/OpenAutark` (dazu `latest-android.json` für `UpdateCheck`).
- **Website-APK ohne Handy-Bedienung:** `.\build.ps1 -Release -Lite` baut zusätzlich `autark-android-lite.apk` (Build-Typ `playLite`, Eintrag `autark-android-lite.json`); bricht ab, wenn das Manifest noch einen AccessibilityService nennt. Grund: Play Protect blockiert seitlich geladene Apps mit Bedienungshilfen-Dienst hart (Samsung, 08.11.2026).
- **Play-Bundles:** `.\build.ps1 -Release -Bundle` baut zusätzlich zwei AAB mit demselben Schlüssel (jarsigner-geprüft, Zertifikat gleich dem der APK, Eintrag `autark-android-play.json`): `autark-android-play.aab` (voll) und `autark-android-play-lite.aab` (Build-Typ `playLite`: `src/playLite/AndroidManifest.xml` entfernt den AccessibilityService und die Offenlegung – Play erlaubt Nicht-Bedienungshilfe-Apps keine KI, die über diese Schnittstelle selbst plant und handelt; `UseConsent.available()` ist dort false, Schritte beantwortet die App mit „off“ und dem Hinweis, dass diese Version keine Handy-Bedienung hat; kein Aktivierungs-Hinweis). Heavy: über `.local/b066/run.sh`. Unterlagen und Entwürfe für die Konsole: `Workforce/play-store-2026-11-07/`.
- **Starttitel:** Release- und Play-Build heißen „Autark“; nur der Debug-Build (`...preview`) heißt „Autark Preview“ (`src/debug/res/values/label.xml`).
- **Host-Tests:** `.\test.ps1` (nur `javac`/`java`, kein Gradle; BouncyCastle aus dem Gradle-Cache): `ConnectionAddressTest`, `RelayCryptoTest`, `relay.RemotePairTest` (SAS-Vektoren aus `remote/sas.ts`), `phoneuse.ScreenTreeTest` (Baum, Tippziel, Gesten) und `phoneuse.DisclosureTest` (Play-Installer-Regel, Pflichtaussagen der Offenlegung); seit B-084 auch `UpdateReleaseTest`, `pair.QrDecodeTest` (ZXing aus dem Gradle-Cache oder `build/test-libs/core-3.5.3.jar`), `CompaniesTest`, `CssColorTest`, `relay.ReconnectTest`, `relay.CodeChainTest`, `PhoneRoutesTest`.

**Nicht geprüft (Stand B-084):** nichts davon lief auf einem Gerät – Scanner und Fotoleiste, Firmenwechsel, Leistenfarben, Reconnect nach Flugmodus/Display aus, KeepAlive, Benachrichtigungen, Teilen, Downloads, Handy-Stimme und die Nachrüstung der Phone-Use-Version (Play Protect) prüft der Owner auf dem S23.

**Nicht geprüft (Stand B-078):** kein Android-Gerät, kein Emulator – Installation, App Links (brauchen `assetlinks.json` mit dem Signaturzertifikat auf der Website), WebView, Zurück, Bedienungshilfen-Dienst, Blase, Gesten, Screenshot, Hintergrund/Doze und Netzwechsel sind offen.
