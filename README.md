# alexa-cookie-service

REST-Service für Amazon-Alexa-Cookies auf Basis von `alexa-cookie2`.

Der Service stellt einen browsergestützten Login-/Proxy-Flow bereit,
speichert den kompletten Registrierungszustand persistent unter `/data`,
liefert Cookie-Exportdaten per HTTP und kann bestehende Cookies zyklisch oder
per API refreshen. Die empfohlene FHEM-Integration holt den Export ab, schreibt
ihn lokal im FHEM-Container und triggert danach den Import in `echodevice`.
`save=<filename>` bleibt nur als Legacy-Kompatibilitätsoption erhalten.

## Schnellstart mit HTTPMOD

Voraussetzung: das `echodevice`-Gerät ist bereits angelegt.
Details siehe hier: https://www.mwinklerblog.de/smarthome/eigene-module/echodevice/

1. Container konfigurieren.

   <details>
   <summary>Details und Links</summary>

   Der `alexa-cookie-service`-Container muss laufen und die Login-URL im Browser erreichbar sein.
   Im typischen Docker-Setup reicht dieses Minimalbeispiel:

   ```yaml
   services:
     alexa-cookie-service:
       image: ghcr.io/fhem/alexa-cookie-service:0.3.1
       environment:
         AUTH_TOKEN: change-me
         PROXY_PUBLIC_HOST: 192.168.178.10
       ports:
         - "58090:58090"
       restart: unless-stopped
   ```

   `COOKIE_EXPORT_DIR` brauchst du nur noch, wenn du den Legacy-Pfad mit
   `save=<filename>` weiter nutzen willst.

   Starten:

   ```text
   docker compose up -d
   ```

   Wichtige Referenzen:
   - [Compose-Beispiel](./docker-compose.yml)
   - [Umgebungsvariablen](#container--und-laufzeitkonfiguration)
   - [Lokaler Exportfluss und Legacy-`save=<filename>`](#datenhaltung)
   </details>

2. HTTPMOD einrichten.

   <details>
   <summary>Details und Links</summary>

   Lege in FHEM ein `HTTPMOD`-Device an, das den Service ansprechen kann.
   Das fertige Beispiel liegt in [scripts/example_fhem_httpmod_package.cfg](./scripts/example_fhem_httpmod_package.cfg).

   Für den empfohlenen Pfad brauchst du:
   - den Status-Endpunkt `http://alexa-cookie-service:58080/api/status`, der bei veraltetem Zustand vor der Antwort automatisch einen Refresh ausloest
   - `get exportCookie` auf `/api/cookie`
   - `set refresh` auf `/api/cookie/refresh`
   - eine lokale FHEM-Callback-Funktion, die den JSON-Body mit `write_cookie_export_and_trigger_import` in das lokale Exportverzeichnis schreibt
   - das Reading `proxyUrl` für die Browser-URL
   - das Reading `message` für die Login-Meldung
   - das Reading `error` für Fehlerzustände

   Optional hilfreich:
   - `get loginUrl` für die direkte Proxy-URL
   - `save=<filename>` bleibt als Legacy-Option auf der Service-Seite erhalten

   </details>

3. Shared Secret setzen.

   ```text
   set AlexaCookieService storeKeyValue alexa_cookie_service_token <dein-token>
   ```

   Das Secret sollte zufaellig sein, zum Beispiel aus:

   ```text
   openssl rand -hex 32
   ```

4. Login-Workflow starten.

   ```text
   set AlexaCookieService loginStart
   ```

   Danach die ausgegebene `proxyUrl` im Browser oeffnen und den Amazon-Login komplett abschliessen.
   Wenn der Browser meldet, dass das Fenster geschlossen werden kann, ist dieser Schritt erledigt.

5. HTTPMOD starten.

   Der periodische `GET /api/status`-Aufruf aktualisiert den Servicezustand automatisch, sobald die letzte Aktualisierung aelter als die konfigurierte Mindestgrenze ist.
   Das `npm_refresh_intervall` im `echodevice` bzw. `HTTPMOD` sollte groesser als der Refresh-Zyklus des Containers konfiguriert werden; sonst kann der Client vor der naechsten gueltigen Aktualisierung erneut pollen und auf die Mindestalter-Pruefung laufen.
   `set AlexaCookieService refresh` bleibt als manueller Fallback erhalten, ist fuer den normalen Polling-Betrieb aber nicht mehr noetig.
   Der anschließende `get exportCookie`-Aufruf liefert das Cookie-JSON, das die lokale FHEM-Hilfsfunktion in die Datei schreibt und danach in `echodevice` importiert.

## Enthaltene Komponenten

- Node.js REST-Service
- Dockerfile
- docker-compose.yml
- `.env.example`
- HTTPMOD-Beispiel und FHEM-Package-Loader

## Wichtige Endpunkte

- `GET /healthz` – Liveness-Check, liefert immer 200 wenn der Prozess laeuft
- `GET /api/status` – Status ohne Geheimnisse, fuer Readiness und Login-Zustand
- `GET /api/state` – gespeicherter Zustand, standardmäßig maskiert
- `GET /api/state?raw=1` – kompletter gespeicherter Zustand
- `POST /api/cookie/login/start` – startet den Login-/Proxy-Flow
- `GET /api/cookie/login/url` – startet den Login-/Proxy-Flow und liefert die Proxy-URL
- `POST /api/cookie/refresh` – Refresh mit `formerRegistrationData`; `save=<filename>` nur fuer Legacy-Kompatibilität
- `GET /api/cookie` – Cookie-Export im `echodevice`-Schema; `save=<filename>` nur fuer Legacy-Kompatibilität
- `GET /api/cookie/text` – nur der Cookie als Text

Die bisherigen Pfade `/api/login/start`, `/api/login/url`, `/api/refresh` und `/api/cookie.txt`
sind abgekündigt.

## Container- Und Laufzeitkonfiguration

Die relevanten Container-Parameter sind bereits im Schnellstart beschrieben.
Falls du nur die Defaults anpassen willst, nutze die Tabelle unten als Referenz.

## Datenhaltung

Der komplette Persistenzzustand wird unter `STATE_FILE` gespeichert.
Dieser Zustand ist die Grundlage für spätere Refreshes.

Zusätzlich schreibt der Service:
- `METADATA_FILE` – Metadaten zum letzten Update

Für den empfohlenen FHEM-Flow gilt:

- `GET /api/cookie` liefert die Export-JSON im Response.
- FHEM schreibt diese JSON lokal in die Datei, die `echodevice` erwartet.
- Danach kann der vorhandene `echodevice_NPMWaitForCookie($hash)`-Pfad ausgelöst werden.

Legacy-Kompatibilität:

- Wenn `save=<filename>` fuer `POST /api/cookie/refresh` oder `GET /api/cookie` verwendet wird,
  schreibt der Service weiterhin eine kompakte Ein-Zeilen-JSON unterhalb von `COOKIE_EXPORT_DIR`.
- `save` ist dabei nur ein Dateiname, kein Pfad.
- Die Legacy-Dateiablage ist nur sinnvoll, wenn Service und FHEM ein gemeinsames Exportverzeichnis haben.
- `COOKIE_EXPORT_FILE` wird aus Kompatibilitaetsgruenden vorerst noch als Legacy-Name akzeptiert.

Das exportierte JSON hat dieses Schema:

```json
{
  "localCookie": "...",
  "csrf": "...",
  "refreshToken": "...",
  "macDms": "...",
  "formerRegistrationData": { "...": "..." }
}
```

Verhalten der Endpunkte:

- Login schreibt nur `STATE_FILE` und `METADATA_FILE`
- `POST /api/cookie/refresh` schreibt keine Exportdatei ohne `save=<filename>`
- `GET /api/cookie` liefert das JSON im Response; mit `save=<filename>` wird zusätzlich die Legacy-Datei geschrieben
- `GET /api/cookie/text` liefert den Cookie als eine Zeile Text
- alle JSON-Ausgaben/-Dateien fuer das `echodevice`-Schema sind kompakt und ohne Zeilenumbrueche
- `save=696result.json` speichert bei `COOKIE_EXPORT_DIR=/opt/fhem/cache/alexa-cookie` nach `/opt/fhem/cache/alexa-cookie/696result.json`

## Architektur und Motivation

Der Service ist bewusst als separater Node.js-Container aufgebaut
und nicht als Erweiterung innerhalb des FHEM-Docker-Containers.

Der Hauptgrund ist die klare Trennung der Laufzeitumgebungen:

- der FHEM-Container ist primaer fuer Perl und eine moeglichst klassische,
  gut wartbare FHEM-Umgebung gedacht
- `alexa-cookie2` bringt eine eigene Node.js-Runtime, eigene Abhaengigkeiten
  und einen eigenen Update-Zyklus mit
- ein gemeinsames Image wuerde zwei technisch unterschiedliche Aufgabenbereiche
  vermischen und dadurch Wartung, Debugging und Updates unnoetig verkomplizieren
- wenn FHEM und der Service auf getrennten Hosts laufen oder kein Shared Volume
  vorhanden ist, kann der Service nicht direkt in das FHEM-Dateisystem schreiben

Seit Version 5 des FHEM-Images ist zudem kein Node Package Manager mehr im
FHEM-(Perl-)Container enthalten.
Fuer Node-basierte Helfer musste deshalb bislang meist ein eigenes,
angepasstes FHEM-Image gebaut werden.

Dieses Projekt verfolgt stattdessen bewusst ein Service-Muster:

```text
FHEM / echodevice -> HTTP/REST -> alexa-cookie-service -> Amazon
```

Das bedeutet:

- `37_echodevice.pm` bleibt im normalen FHEM-Container
- der Node.js-Dienst kapselt Login-, Refresh- und Cookie-Export-Funktionen
- die Kopplung erfolgt ueber eine klar definierte HTTP-Schnittstelle
- beide Container koennen getrennt gebaut, aktualisiert, neu gestartet und
  debuggt werden

Die Trennung ist damit keine unnoetige Zusatzkomplexitaet,
sondern eine bewusste Designentscheidung zugunsten von Stabilitaet,
Wartbarkeit und klaren Zustaendigkeiten.
Der empfohlene FHEM-Flow holt die Cookie-JSON deshalb per HTTP ab, schreibt sie
lokal im FHEM-Container und triggert danach den vorhandenen Importpfad.

## FHEM-Anbindung

Das Repository enthält generische FHEM-Helfer.
Die empfohlene Einbindung ruft `GET /api/cookie` per HTTPMOD ab, schreibt die Exportdatei lokal in FHEM und triggert danach den bestehenden `echodevice`-Import.

Ausfuehrliche Hintergruende zur FHEM-Integration, zum Exportnamen, zum lokalen Schreiben und zu den optionalen Triggern stehen in den Abschnitten oben und im Beispiel [scripts/example_fhem_httpmod_package.cfg](./scripts/example_fhem_httpmod_package.cfg).

Das einzige gepflegte Anwenderbeispiel ist [scripts/example_fhem_httpmod_package.cfg](./scripts/example_fhem_httpmod_package.cfg).
Andere Beispielpfade wie `at`/`notify`-Fragmente oder Shell-Skripte werden nicht mehr mitgeliefert.

## Sicherheitshinweise

- Die REST-API liefert Geheimnisse. Setze `AUTH_TOKEN`.
- Stelle den Service idealerweise nur im internen Netz bereit.
- Nutze bei Remote-Zugriff einen Reverse Proxy mit TLS und zusätzlicher Authentifizierung.
- Lege `/data` auf ein persistentes Volume.

## Bekannte Grenzen

- Amazon kann Login-Flows jederzeit ändern.
- MFA, Captcha und Regionseffekte bleiben möglich.
- Der initiale Login ist absichtlich browsergestützt; das ist robuster als ein erzwungener Headless-Flow.

## Empfohlener Importfluss

Für getrennte Hosts oder Deployments ohne Shared Volume ist der empfohlene Ablauf:

1. `GET /api/status` aus FHEM aufrufen, damit der Servicezustand bei Bedarf automatisch per Refresh aktualisiert wird.
2. `GET /api/cookie` abrufen.
3. Die Response lokal in die von `echodevice` erwartete Datei schreiben.
4. `echodevice_NPMWaitForCookie($hash)` aus dem FHEM-seitigen Code triggern.

`POST /api/cookie/refresh` und `save=<filename>` bleiben als manuelle Legacy-/Fallback-Optionen erhalten, sind aber nicht der empfohlene Standardpfad.
