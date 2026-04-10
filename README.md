# alexa-cookie-service

Eigenständiger Cookie-/Refresh-Service für Amazon Alexa auf Basis von `alexa-cookie`.

Zielbild:
- `alexa-cookie` läuft nicht mehr direkt im FHEM-Prozess
- Cookie- und Refresh-Daten liegen persistent in `/data`
- FHEM oder andere Systeme können den Zustand per REST abrufen
- der Service kann den Cookie zyklisch erneuern

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
- `POST /api/refresh` – Refresh mit `formerRegistrationData`
- `GET /api/cookie` – Cookie, CSRF und Refresh-Token als JSON
- `GET /api/cookie.txt` – nur der Cookie als Text

## Schnellstart

### 1. Konfiguration vorbereiten

```bash
cp .env.example .env
```

Wichtig:
- `PROXY_OWN_IP` muss die Adresse oder den Hostnamen enthalten, unter dem du den Login-Proxy im Browser wirklich aufrufst
- `AUTH_TOKEN` setzen, wenn die API nicht offen im LAN stehen soll

### 2. Starten

```bash
docker compose up -d --build
```

### 3. Status prüfen

```bash
curl -H "x-auth-token: change-me" http://127.0.0.1:8080/api/status
```

### 4. Login starten

```bash
curl -X POST -H "x-auth-token: change-me" http://127.0.0.1:8080/api/login/start
```

Danach den Proxy im Browser aufrufen:

```text
http://<PROXY_OWN_IP>:8090/
```

## Datenhaltung

Der komplette Persistenzzustand wird unter `STATE_FILE` gespeichert. Dieser Zustand muss erhalten bleiben, damit spätere Refreshes stabil funktionieren.

Zusätzlich exportiert der Service:
- `COOKIE_EXPORT_FILE` – nur der Cookie-String
- `METADATA_FILE` – Metadaten zum letzten Update

## FHEM-Anbindung

Das Projekt enthält nur generische FHEM-Helfer, weil `echodevice` installationsabhängig ist.

Hilfsskripte:
- `scripts/fhem_fetch_cookie.sh`
- `scripts/fhem_dump_cookie_json.sh`
- `scripts/example_fhem_notify.txt`

Typische Varianten:

### Variante A: FHEM spiegelt nur den Cookie lokal

```bash
SERVICE_URL=http://127.0.0.1:8080 AUTH_TOKEN=change-me OUT_FILE=/opt/fhem/cache/alexa-cookie-external-cookie.txt ./scripts/fhem_fetch_cookie.sh
```

### Variante B: FHEM spiegelt den kompletten Zustand lokal

```bash
SERVICE_URL=http://127.0.0.1:8080 AUTH_TOKEN=change-me OUT_FILE=/opt/fhem/cache/alexa-cookie-external-state.json ./scripts/fhem_dump_cookie_json.sh
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

## Wann Codex sinnvoll wäre

Dieses Paket ist sofort nutzbar. Ein Wechsel in Codex wäre nur dann sinnvoll, wenn du im nächsten Schritt eine echte, versionsgenaue Anpassung direkt an `37_echodevice.pm` oder einen vollständigen FHEM-Patch erzeugen willst.
