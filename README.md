# alexa-cookie-service

REST-Service für Amazon-Alexa-Cookies auf Basis von `alexa-cookie2`.

Der Service stellt einen browsergestützten Login-/Proxy-Flow bereit,
speichert den kompletten Registrierungszustand persistent unter `/data`,
exportiert eine zu `37_echodevice.pm` kompatible JSON-Cachedatei
und kann bestehende Cookies zyklisch oder per API refreshen.

## Enthaltene Komponenten

- Node.js REST-Service
- Dockerfile
- docker-compose.yml
- `.env.example`
- Hilfsskripte für FHEM

## Wichtige Endpunkte

- `GET /healthz` – Healthcheck
- `GET /api/status` – Status ohne Geheimnisse
- `GET /api/state` – gespeicherter Zustand, standardmäßig maskiert
- `GET /api/state?raw=1` – kompletter gespeicherter Zustand
- `POST /api/login/start` – startet den Login-/Proxy-Flow
- `GET /api/login/url` – startet den Login-/Proxy-Flow und liefert die Proxy-URL
- `POST /api/refresh` – Refresh mit `formerRegistrationData`
- `GET /api/cookie` – JSON-Cachedatei im `echodevice`-Schema
- `GET /api/cookie.txt` – nur der Cookie als Text

## Schnellstart

### 1. Konfiguration vorbereiten

```bash
cp .env.example .env
```

Sicheren `AUTH_TOKEN` erzeugen und in `.env` eintragen:

```bash
openssl rand -hex 32
```

Wichtig:
- `PROXY_OWN_IP` muss die Adresse oder den Hostnamen enthalten, unter dem du den Login-Proxy im Browser wirklich aufrufst
- `AUTH_TOKEN` setzen, wenn die API nicht offen im LAN stehen soll

### Umgebungsvariablen

| Variable | Status | Standardwert | Bedeutung |
| --- | --- | --- | --- |
| `HOST` | Optional | `0.0.0.0` | Bind-Adresse der REST-API im Container |
| `PORT` | Optional | `58080` | Port der REST-API im Container |
| `AUTH_TOKEN` | Empfohlen | leer | Shared Secret fuer `x-auth-token`; im produktiven Betrieb praktisch Pflicht |
| `DATA_DIR` | Optional | `/data` | Basisverzeichnis fuer persistente Servicedaten |
| `STATE_FILE` | Optional | `${DATA_DIR}/alexa-registration.json` | Persistierter Alexa-Registrierungszustand |
| `METADATA_FILE` | Optional | `${DATA_DIR}/service-metadata.json` | Metadaten zur letzten Aktualisierung |
| `COOKIE_EXPORT_FILE` | Optional | `${DATA_DIR}/cookie.json` | Zieldatei fuer die von `37_echodevice.pm` erwartete Cookie-Cachedatei |
| `DEBUG_HTML_DIR` | Optional | `${DATA_DIR}/debug-html` | Ablageort fuer Debug-Artefakte aus dem Login-Flow |
| `AMAZON_PAGE` | Optional | `amazon.de` | Ziel-Region fuer den Amazon-Login |
| `BASE_AMAZON_PAGE` | Optional | Wert von `AMAZON_PAGE` | Basis-Domain fuer den Login-Flow |
| `ACCEPT_LANGUAGE` | Optional | `de-DE` | Sprach-Header fuer den Login-Flow |
| `PROXY_OWN_IP` | Pflicht | leer | Von Browsern erreichbare IP oder DNS-Name des Docker-Hosts fuer den Login-Proxy |
| `PROXY_LISTEN_BIND` | Optional | `0.0.0.0` | Bind-Adresse des Login-Proxys im Container |
| `PROXY_PORT` | Optional | `58090` | Port des Login-Proxys im Container |
| `PROXY_ONLY` | Optional | `true` | Startet den Login standardmaessig im Proxy-Modus |
| `SETUP_PROXY` | Optional | `true` | Aktiviert die Proxy-Initialisierung fuer den Login-Flow |
| `APP_NAME` | Optional | `FHEM EchoDevice Cookie Service` | Anzeigename des virtuellen Geraets bei Amazon |
| `USE_HERMES` | Optional | `false` | Aktiviert Hermes-spezifisches Verhalten von `alexa-cookie2` |
| `REFRESH_SCHEDULE_HOURS` | Optional | `24` | Intervall fuer den automatischen Refresh |
| `REFRESH_MIN_AGE_HOURS` | Optional | `6` | Mindestalter des Zustands vor einem automatischen Refresh |
| `REQUEST_TIMEOUT_MS` | Optional | `30000` | Timeout fuer Netzwerkoperationen in Millisekunden |
| `LOG_LEVEL` | Optional | `combined` | Format/Level fuer HTTP-Request-Logging |

### 2. Starten

```bash
docker pull ghcr.io/fhem/alexa-cookie-service:0.2.0
docker compose up -d
```

### 3. Status prüfen

```bash
curl -H "x-auth-token: change-me" http://127.0.0.1:58080/api/status
```

### 4. Login starten

```bash
curl -X POST -H "x-auth-token: change-me" http://127.0.0.1:58080/api/login/start
```

Danach den Proxy im Browser aufrufen:

```text
http://<PROXY_OWN_IP>:58090/
```

## Datenhaltung

Der komplette Persistenzzustand wird unter `STATE_FILE` gespeichert.
Dieser Zustand ist die Grundlage für spätere Refreshes.

Zusätzlich exportiert der Service:
- `COOKIE_EXPORT_FILE` – JSON im von `37_echodevice.pm` erwarteten Schema
- `METADATA_FILE` – Metadaten zum letzten Update

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

## FHEM-Anbindung

Das Repository enthält generische FHEM-Helfer.
Die konkrete Einbindung von `37_echodevice.pm` bleibt installationsabhängig.

### Docker-Stack mit FHEM erweitern

Ein typisches Setup ist ein gemeinsamer Docker-Stack mit FHEM.
Dabei teilen sich beide Container ein dediziertes Cache-Verzeichnis,
in das der Service die JSON-Cachedatei direkt schreibt.
Wenn der Cookie-Service mit derselben UID/GID wie FHEM läuft,
bleiben Besitzrechte und Schreibzugriffe konsistent.

Funktionsfähiges Beispiel für einen gemeinsamen Compose-Stack:

```yaml
services:
  fhem:
    image: ghcr.io/fhem/fhem-docker:5-bookworm
    volumes:
      - "./fhem/:/opt/fhem/"
      - "./fhem/cache:/opt/fhem/cache"
    environment:
      FHEM_UID: 6061
      FHEM_GID: 6061
      TIMEOUT: 10
      RESTART: 1
      TZ: Europe/Berlin
    ports:
      - "8083:8083"
    networks:
      - fhem_cookie_net
    restart: always

  alexa-cookie-service:
    image: ghcr.io/fhem/alexa-cookie-service:0.2.0
    volumes:
      - ./alexa-cookie-data:/data
      - ./fhem/cache:/opt/fhem/cache
    environment:
      AUTH_TOKEN: change-me
      COOKIE_EXPORT_FILE: /opt/fhem/cache/alexa-cookie.json
      STATE_FILE: /data/alexa-registration.json
      METADATA_FILE: /data/service-metadata.json
      PROXY_OWN_IP: 192.168.178.10
    env_file:
      - .env
    ports:
      - "58090:58090"
    networks:
      - fhem_cookie_net
    restart: unless-stopped
    user: "6061:6061"

networks:
  fhem_cookie_net:
    driver: bridge
```

In diesem Setup:
- FHEM erreicht die API intern unter `http://alexa-cookie-service:58080`
- der Login-Proxy bleibt über `http://<PROXY_OWN_IP>:58090/` vom Browser erreichbar
- die aktuelle Cookie-Cachedatei liegt für FHEM direkt unter `./fhem/cache/alexa-cookie.json`

Das Beispiel verwendet `ghcr.io/fhem/fhem-docker:5-bookworm`,
das veröffentlichte Image `ghcr.io/fhem/alexa-cookie-service:0.2.0`
und ein dediziertes Docker-Netz.

Wichtig:
`PROXY_OWN_IP` ist in diesem Szenario die IP-Adresse oder der DNS-Name des Docker-Hosts,
also des Rechners, auf dem die Container laufen.
Gemeint ist nicht der Containername `alexa-cookie-service`
und auch nicht die interne Docker-IP,
weil der Login-Proxy vom Browser außerhalb des Docker-Netzes erreichbar sein muss.

Wichtig für Dateirechte:
Der Cookie-Service läuft hier mit `user: "6061:6061"`
und damit passend zu `FHEM_UID`/`FHEM_GID`.
So werden neu geschriebene Dateien in `./fhem/cache`
mit kompatiblen Besitzrechten angelegt,
statt als `root`.

Wenn `37_echodevice.pm` im FHEM-Container läuft, sollte es daher auf `/opt/fhem/cache/alexa-cookie.json` zeigen.

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

## Einbindung in  `37_echodevice.pm`

`37_echodevice.pm` liest die Cookie-Daten aus einer lokalen Datei.
Der Service erzeugt und erneuert diese Daten.
FHEM triggert bei Bedarf den Refresh
und schreibt oder verwendet die exportierte Cachedatei lokal:
- den `AUTH_TOKEN` aus der `.env` in FHEM hinterlegen
- aus FHEM `POST /api/refresh` aufrufen
- danach die aktuelle Cookie-Cachedatei nach `/opt/fhem/cache/...` spiegeln
- `echodevice` unverändert auf diese lokale Datei zeigen lassen

Wichtig: Es gibt keinen separaten Endpoint, der den API-Key ausgibt. Der Wert ist identisch mit `AUTH_TOKEN` aus der `.env` des Containers/Services.

### Token in FHEM hinterlegen

Einmalig in FHEM ausführen:

```perl
{ setKeyValue('alexa_cookie_service_token','change-me') }
```

Voraussetzung dafür ist ein gesetztes `uniqueID` in FHEM.
Danach kann der Token in Perl-Blöcken per `getKeyValue(...)` gelesen werden,
ohne ihn im Klartext in jedem `define` zu hinterlegen.

### Funktionsfähiges FHEM-Beispiel ohne HTTPMOD

Das Beispiel ruft den Refresh-Endpunkt auf
und spiegelt danach die JSON-Cachedatei in eine lokale Datei,
die `37_echodevice.pm` direkt verwenden kann:

```perl
define AlexaCookieRefresh at +*06:00:00 {
  my $token = getKeyValue('alexa_cookie_service_token');;
  return 'missing token' if !$token;;
  my $base = 'http://127.0.0.1:58080';;

  my $refresh = qx(curl -fsS -X POST -H 'x-auth-token: $token' $base/api/refresh 2>&1);;
  return "refresh failed: $refresh" if $? != 0;;

  my $cookie_json = qx(curl -fsS -H 'x-auth-token: $token' $base/api/cookie 2>&1);;
  return "cookie fetch failed: $cookie_json" if $? != 0;;

  my $file = '/opt/fhem/cache/alexa-cookie-external.json';;
  FileWrite($file, $cookie_json);;
  Log 1, "AlexaCookieRefresh wrote cookie json to $file";;
}
```

`37_echodevice.pm` muss dann auf `/opt/fhem/cache/alexa-cookie-external.json` zeigen.

Wenn beide Container wie oben gezeigt denselben Cache teilen,
kann das Beispiel noch einfacher werden,
weil der Service die Cachedatei schon selbst nach `/opt/fhem/cache/alexa-cookie.json` schreibt.
Dann reicht in FHEM oft schon der reine Refresh:

```perl
define AlexaCookieRefresh at +*06:00:00 {
  my $token = getKeyValue('alexa_cookie_service_token');;
  return 'missing token' if !$token;;
  my $base = 'http://alexa-cookie-service:58080';;

  my $refresh = qx(curl -fsS -X POST -H 'x-auth-token: $token' $base/api/refresh 2>&1);;
  return "refresh failed: $refresh" if $? != 0;;

  Log 1, 'AlexaCookieRefresh refreshed cookie via shared docker volume';;
}
```

In diesem Fall verwendet `37_echodevice.pm` direkt `/opt/fhem/cache/alexa-cookie.json`.

### HTTPMOD-Beispiel für Status/Monitoring

Für Monitoring ist `HTTPMOD` sinnvoller als für den eigentlichen Cookie-Download.
Beispiel für `/api/status`:

```text
define AlexaCookieStatus HTTPMOD http://127.0.0.1:58080/api/status 300
attr AlexaCookieStatus requestHeader01 x-auth-token: change-me
attr AlexaCookieStatus reading01JSON ok
attr AlexaCookieStatus reading02JSON updatedAt
attr AlexaCookieStatus reading03JSON ageHours
attr AlexaCookieStatus reading04JSON hasCookie
attr AlexaCookieStatus reading05JSON hasRefreshToken
```

Wenn der Token nicht im Klartext in den Attributen stehen soll,
ist der Refresh-/Fetch-Ablauf über einen Perl-Block
oder ein kleines Shell-Skript in FHEM meist direkter als `HTTPMOD`.

Ein minimales Shell-Beispiel liegt zusätzlich in `scripts/example_fhem_notify.txt`.
