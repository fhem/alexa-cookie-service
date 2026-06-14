# alexa-cookie-service

REST-Service für Amazon-Alexa-Cookies auf Basis von `alexa-cookie2`.

Der Service stellt einen browsergestützten Login-/Proxy-Flow bereit,
speichert den kompletten Registrierungszustand persistent unter `/data`,
liefert bei Bedarf eine zu `37_echodevice.pm` kompatible JSON-Cachedatei
und kann bestehende Cookies zyklisch oder per API refreshen.

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
         COOKIE_EXPORT_DIR: /opt/fhem/cache/alexa-cookie
         PROXY_PUBLIC_HOST: 192.168.178.10
       ports:
         - "58090:58090"
       restart: unless-stopped
   ```

   Starten:

   ```text
   docker compose up -d
   ```

   Wichtige Referenzen:
   - [Compose-Beispiel](./docker-compose.yml)
   - [Umgebungsvariablen](#container--und-laufzeitkonfiguration)
   - [Exportname und `save=<filename>`](#datenhaltung)
   </details>

2. HTTPMOD einrichten.

   <details>
   <summary>Details und Links</summary>

   Lege in FHEM ein `HTTPMOD`-Device an, das den Service ansprechen kann.
   Das fertige Beispiel liegt in [scripts/example_fhem_httpmod_package.cfg](./scripts/example_fhem_httpmod_package.cfg).

   Für den Minimalpfad brauchst du:
   - den Status-Endpunkt `http://alexa-cookie-service:58080/api/status`
   - `set loginStart` auf `/api/cookie/login/start`
   - das Reading `proxyUrl` für die Browser-URL
   - das Reading `message` für die Login-Meldung
   - das Reading `error` für Fehlerzustände

   Optional hilfreich:
   - `get loginUrl` für die direkte Proxy-URL
   - `set refresh` für den späteren Refresh
   - `get exportCookie` für den manuellen Export

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

   Wenn der Login erfolgreich abgeschlossen ist, den Refresh ausloesen:

   ```text
   set AlexaCookieService refresh
   ```

   Damit wird die Cookie-Datei geschrieben und der nachgelagerte Import in `echodevice` angestossen.

## Enthaltene Komponenten

- Node.js REST-Service
- Dockerfile
- docker-compose.yml
- `.env.example`
- Hilfsskripte für FHEM

## Wichtige Endpunkte

- `GET /healthz` – Liveness-Check, liefert immer 200 wenn der Prozess laeuft
- `GET /api/status` – Status ohne Geheimnisse, fuer Readiness und Login-Zustand
- `GET /api/state` – gespeicherter Zustand, standardmäßig maskiert
- `GET /api/state?raw=1` – kompletter gespeicherter Zustand
- `POST /api/cookie/login/start` – startet den Login-/Proxy-Flow
- `GET /api/cookie/login/url` – startet den Login-/Proxy-Flow und liefert die Proxy-URL
- `POST /api/cookie/refresh` – Refresh mit `formerRegistrationData`, optional `save=<filename>`
- `GET /api/cookie` – JSON-Cachedatei im `echodevice`-Schema, optional `save=<filename>`
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

Wichtig:
Wenn `save=<filename>` fuer `POST /api/cookie/refresh` oder `GET /api/cookie` verwendet wird,
wird die JSON-Datei absichtlich kompakt in einer einzelnen Zeile geschrieben,
weil `37_echodevice.pm` den JSON-Import zeilenbasiert implementiert und mit mehrzeiligem
Pretty-Print nicht korrekt arbeitet.
`save` ist dabei nur ein Dateiname, kein Pfad.
Die Datei wird immer unterhalb von `COOKIE_EXPORT_DIR` gespeichert.
`COOKIE_EXPORT_FILE` wird aus Kompatibilitaetsgruenden vorerst noch als Legacy-Name akzeptiert.

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
- `GET /api/cookie` liefert das JSON im Response und speichert es nur mit `save=<filename>`
- `GET /api/cookie/text` liefert den Cookie als eine Zeile Text
- alle JSON-Ausgaben/-Dateien fuer das `echodevice`-Schema sind kompakt und ohne Zeilenumbrueche
- `save=696result.json` speichert bei `COOKIE_EXPORT_DIR=/opt/fhem/cache/alexa-cookie` nach `/opt/fhem/cache/alexa-cookie/696result.json`

Beispiele:

```bash
curl -X POST -H "x-auth-token: change-me" \
  "http://127.0.0.1:58080/api/cookie/refresh?save=696result.json"
```

```bash
curl -H "x-auth-token: change-me" \
  "http://127.0.0.1:58080/api/cookie?save=696result.json"
```

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

## FHEM-Anbindung

Das Repository enthält generische FHEM-Helfer.
Die konkrete Einbindung von `37_echodevice.pm` bleibt installationsabhängig.

Ausfuehrliche Hintergruende zur FHEM-Integration, zum Exportnamen und zu den optionalen Triggern stehen in den Abschnitten oben und im Beispiel [scripts/example_fhem_httpmod_package.cfg](./scripts/example_fhem_httpmod_package.cfg).

## Alternaive Zugrifswege

Hilfsskripte:
- `scripts/fhem_fetch_cookie.sh`
- `scripts/fhem_dump_cookie_json.sh`
- `scripts/example_fhem_notify.txt`

Typische Varianten:

### Variante A: FHEM spiegelt nur den Cookie lokal

```bash
SERVICE_URL=http://127.0.0.1:58080 AUTH_TOKEN=change-me OUT_FILE=/opt/fhem/cache/alexa-cookie-external-cookie.txt ./scripts/fhem_fetch_cookie.sh
```

### Variante B: FHEM spiegelt den kompletten Zustand lokal

```bash
SERVICE_URL=http://127.0.0.1:58080 AUTH_TOKEN=change-me OUT_FILE=/opt/fhem/cache/alexa-cookie-external-state.json ./scripts/fhem_dump_cookie_json.sh
```

## Sicherheitshinweise

- Die REST-API liefert Geheimnisse. Setze `AUTH_TOKEN`.
- Stelle den Service idealerweise nur im internen Netz bereit.
- Nutze bei Remote-Zugriff einen Reverse Proxy mit TLS und zusätzlicher Authentifizierung.
- Lege `/data` auf ein persistentes Volume.

## Bekannte Grenzen

- Amazon kann Login-Flows jederzeit ändern.
- MFA, Captcha und Regionseffekte bleiben möglich.
- Der initiale Login ist absichtlich browsergestützt; das ist robuster als ein erzwungener Headless-Flow.

## Mögliche Zukünfrige Einbindung in  `37_echodevice.pm`

`37_echodevice.pm` liest die Cookie-Daten anstatt aus einer lokalen Datei direkt von diesem Service.
Das echomodul FHEM triggert bei Bedarf den Refresh per REST API und verwendet die vorhandenen Werte aus dem Service:
- den `AUTH_TOKEN` aus der `.env` in FHEM hinterlegen
- aus FHEM `POST /api/cookie/refresh?save=<filename>` aufrufen
- danach den aktuellen Cookie mit `GET /api/cookie` abrufen und in `echodevice` verwenden.
