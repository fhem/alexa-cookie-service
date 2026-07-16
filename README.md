# alexa-cookie-service

REST-Service für Amazon-Alexa-Cookies auf Basis von `alexa-cookie2`.

Der Service stellt einen browsergestützten Login-/Proxy-Flow bereit,
speichert den kompletten Registrierungszustand persistent unter `/data`,
liefert Cookie-Exportdaten per HTTP und kann bestehende Cookies zyklisch oder
per API refreshen. Die empfohlene FHEM-Integration holt den Export ab, schreibt
ihn lokal im FHEM-Container und triggert danach den Import in `echodevice`.
Fuer den sicheren Standardbetrieb sollte `TLS_ENABLED=true` gesetzt sein,
besonders wenn FHEM und `alexa-cookie-service` nicht auf demselben Host laufen.
`save=<filename>` bleibt nur als Legacy-Kompatibilitätsoption erhalten.

## Schnellstart mit HTTPMOD

Voraussetzung: das `echodevice`-Gerät ist bereits angelegt.
Details siehe hier: https://www.mwinklerblog.de/smarthome/eigene-module/echodevice/

1. Container konfigurieren.

   <details>
   <summary>Details und Links</summary>

   Der `alexa-cookie-service`-Container muss laufen und die Login-URL im Browser erreichbar sein.
   Der Code-Default bleibt rueckwaertsvertraeglich bei `TLS_ENABLED=false`,
   dokumentiert und empfohlen ist aber `TLS_ENABLED=true` fuer den normalen Betrieb.
   Das gilt besonders dann, wenn FHEM und der Service auf getrennten Hosts laufen.
   Im typischen Docker-Setup reicht dieses Minimalbeispiel:

   ```yaml
   services:
     alexa-cookie-service:
       image: ghcr.io/fhem/alexa-cookie-service:0.4.1
       environment:
         AUTH_TOKEN: change-me
         TLS_ENABLED: "true"
         PROXY_PUBLIC_HOST: 192.168.178.10
       ports:
         - "58080:58080"
         - "58090:58090"
       restart: unless-stopped
   ```

   Wenn du ein extern bereitgestelltes Leaf-Zertifikat verwenden willst, sieht
   die Service-Konfiguration eher so aus:

   ```yaml
   services:
     alexa-cookie-service:
       image: ghcr.io/fhem/alexa-cookie-service:0.4.1
       environment:
         AUTH_TOKEN: change-me
         TLS_ENABLED: "true"
         TLS_SERVER_CERT_MODE: external
         TLS_SERVER_NAME: acs.example.internal
         TLS_SERVER_KEY_FILE: /data/tls/server.key
         TLS_SERVER_CERT_FILE: /data/tls/server.crt
         TLS_CA_CERT_FILE: /data/tls/external-ca.crt # only for a private CA
         PROXY_PUBLIC_HOST: 192.168.178.10
       volumes:
         - ./leaf/server.key:/data/tls/server.key:ro
         - ./leaf/server.crt:/data/tls/server.crt:ro
         - ./leaf/ca.crt:/data/tls/external-ca.crt:ro # only for a private CA
       ports:
         - "58080:58080"
         - "58090:58090"
       restart: unless-stopped
   ```

   In diesem Fall muss FHEM die CA oder Chain des Leaf-Zertifikats kennen; ein
   passendes `sslArgs`-Beispiel steht weiter unten.
   Die Portfreigabe `58080:58080` macht die REST-API fuer FHEM auf einem anderen
   Host erreichbar. Wenn FHEM im selben Docker-Netzwerk laeuft und den Service
   ueber `alexa-cookie-service:58080` anspricht, kann diese Host-Portfreigabe
   entfallen. Port `58090` muss fuer den Browser erreichbar bleiben.

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
   - den Status-Endpunkt `https://alexa-cookie-service:58080/api/status`, der bei veraltetem Zustand vor der Antwort automatisch einen Refresh ausloest
   - `get exportCookie` auf `/api/cookie`
   - `set refresh` auf `/api/cookie/refresh`
   - eine lokale FHEM-Callback-Funktion, die den JSON-Body mit `write_cookie_export_and_trigger_import` in das lokale Exportverzeichnis schreibt
   - das Reading `proxyUrl` für die Browser-URL
   - das Reading `message` für die Login-Meldung
   - das Reading `error` für Fehlerzustände
   - eine `sslArgs`-Konfiguration, die der FHEM-Instanz die CA-Datei des Services vertraut macht

   Optional hilfreich:
   - `get loginUrl` für die direkte Proxy-URL
   - `save=<filename>` bleibt als Legacy-Option auf der Service-Seite erhalten
   - `sslArgs` mit einer lesbaren CA-Datei statt deaktivierter Zertifikatspruefung

   Wenn FHEM und der Service nicht denselben Host teilen, kopiere oder mounte die vom Service erzeugte CA-Datei aus `/data/tls/ca.crt` in einen Pfad, den FHEM lesen kann. Ein konkretes Beispiel ist ein Read-only-Bind-Mount auf `/opt/fhem/ssl/alexa-cookie-service-ca.crt`.
   Für ein extern bereitgestelltes Leaf-Zertifikat kannst du stattdessen die ausstellende CA oder Chain mounten und FHEM so konfigurieren:

   ```text
   attr AlexaCookieService sslArgs SSL_ca_file=/opt/fhem/ssl/acs-leaf-ca.crt,SSL_verify_mode=1
   ```

   Ein passendes Compose-Beispiel für die FHEM-Seite ist weiter unten in der eigenen CA-Variante gezeigt.

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
Der dokumentierte sichere Standard ist `TLS_ENABLED=true`; `TLS_ENABLED=false`
bleibt nur als Rueckwaertskompatibilitaets-Default im Code erhalten.
Der interne Container-Healthcheck verbindet sich standardmaessig mit
`127.0.0.1`. Mit `HEALTHCHECK_HOST` kann dieses Request-Ziel unabhaengig von
der Bind-Adresse `HOST` angepasst werden. `HOST=0.0.0.0` sollte daher nicht als
Healthcheck-Ziel verwendet werden.

## TLS-Konfiguration

### Standard TLS

Das ist der empfohlene Standardfall fuer neue Installationen.

- `TLS_ENABLED=true`
- der Service erzeugt unter `TLS_DIR` eine lokale CA
- die CA wird standardmaessig in `/data/tls/ca.crt` gespeichert
- das Serverzertifikat wird fuer den konfigurierten Servicenamen ausgestellt
- FHEM sollte der lokalen CA ueber `sslArgs` vertrauen statt die Pruefung abzuschalten

Typische Konfiguration im Service:

```yaml
environment:
  TLS_ENABLED: "true"
  DATA_DIR: /data
```

Typische FHEM-Seite:

```text
attr AlexaCookieService sslArgs SSL_ca_file=/opt/fhem/ssl/alexa-cookie-service-ca.crt,SSL_verify_mode=1
```

Compose-Anpassungen fuer diese Variante:

ACS-Container:

```yaml
services:
  alexa-cookie-service:
    environment:
      TLS_ENABLED: "true"
      DATA_DIR: /data
    volumes:
      - ./data:/data
```

FHEM-Container:

```yaml
services:
  fhem:
    volumes:
      - ./data/tls/ca.crt:/opt/fhem/ssl/alexa-cookie-service-ca.crt:ro
```

Wenn FHEM und der Service nicht denselben Host teilen, kopiere oder mounte
`/data/tls/ca.crt` an einen lesbaren Pfad in FHEM, zum Beispiel als
Read-only-Bind-Mount auf `/opt/fhem/ssl/alexa-cookie-service-ca.crt`.

### Eigene Root-CA

Diese Variante ist fuer Umgebungen gedacht, in denen du bereits eine eigene
Root-CA verwaltest und FHEM dieser CA ohnehin vertraut.

- `TLS_ENABLED=true`
- `TLS_CA_KEY_FILE` und `TLS_CA_CERT_FILE` zeigen auf deine Root-CA
- `TLS_SERVER_KEY_FILE` und `TLS_SERVER_CERT_FILE` bestimmen die Leaf-Dateien
- `TLS_SERVER_NAME` sollte auf den DNS-Namen zeigen, den FHEM wirklich anspricht
- der Service stellt das Serverzertifikat aus deiner CA selbst aus
- FHEM vertraut derselben Root-CA oder einer daraus abgeleiteten CA-Chain

Beispiel fuer eine eingebundene Root-CA im Service-Container:

```yaml
services:
  alexa-cookie-service:
    environment:
      TLS_ENABLED: "true"
      TLS_CA_KEY_FILE: /data/tls/root-ca.key
      TLS_CA_CERT_FILE: /data/tls/root-ca.crt
      TLS_SERVER_KEY_FILE: /data/tls/server.key
      TLS_SERVER_CERT_FILE: /data/tls/server.crt
    volumes:
      - ./data:/data
      - ./root-ca/root-ca.key:/data/tls/root-ca.key:ro
      - ./root-ca/root-ca.crt:/data/tls/root-ca.crt:ro
```

FHEM-Container:

```yaml
services:
  fhem:
    volumes:
      - ./root-ca/root-ca.crt:/opt/fhem/ssl:ro
```

Wenn du die Root-CA ausserhalb des Containers verwaltest, mounte nur die
oeffentliche CA-Datei in FHEM und verwende sie in `sslArgs`:

```text
attr AlexaCookieService sslArgs SSL_ca_file=/opt/fhem/ssl/root-ca.crt,SSL_verify_mode=1
```

Die private Root-CA-Schluesseldatei muss in diesem Fall nur dem Service
zugreifbar sein, wenn der Service das Serverzertifikat selbst ausstellen soll.
FHEM braucht dafuer nur die oeffentliche CA-Datei.

### Bereitgestelltes Serverzertifikat

Diese Variante ist fuer Faelle gedacht, in denen du das Leaf-Zertifikat
extern erzeugst und ACS nur die fertigen Dateien bereitstellt.

- `TLS_ENABLED=true`
- `TLS_SERVER_CERT_MODE=external`
- `TLS_SERVER_KEY_FILE` und `TLS_SERVER_CERT_FILE` zeigen auf die extern
  bereitgestellten Leaf-Dateien
- bei einer privaten CA zeigt `TLS_CA_CERT_FILE` auf deren eingebundene CA- oder
  Chain-Datei; der interne Healthcheck verwendet diese zur Verifikation
- bei einer oeffentlich bzw. systemweit vertrauten CA bleibt
  `TLS_CA_CERT_FILE` ungesetzt und der Healthcheck verwendet den Node-System-Truststore
- ACS erzeugt in diesem Modus keine lokale CA und stellt das Zertifikat nicht
  selbst aus
- FHEM vertraut weiterhin der ausstellenden CA oder der Chain; bei einem
  explizit self-signed Leaf kann auch das Leaf-Zertifikat selbst als Trust-
  Anker dienen, das ist aber nur ein Spezialfall

Beispiel mit extern bereitgestelltem Leaf-Zertifikat:

```yaml
services:
  alexa-cookie-service:
    environment:
      TLS_ENABLED: "true"
      TLS_SERVER_CERT_MODE: external
      TLS_SERVER_NAME: acs.example.internal
      TLS_SERVER_KEY_FILE: /data/tls/server.key
      TLS_SERVER_CERT_FILE: /data/tls/server.crt
      TLS_CA_CERT_FILE: /data/tls/external-ca.crt # nur bei privater CA
    volumes:
      - ./leaf/server.key:/data/tls/server.key:ro
      - ./leaf/server.crt:/data/tls/server.crt:ro
      - ./leaf/ca.crt:/data/tls/external-ca.crt:ro # nur bei privater CA
```

### Private CA ausserhalb des Containers

Diese Variante ist fuer Betreiber gedacht, die ihre Root- oder Intermediate-CA
separat erzeugen und verwalten und ACS nur die fertigen PKI-Materialien
bereitstellen.

- die private CA bleibt ausserhalb von FHEM und idealerweise auch ausserhalb
  des normalen Betriebs-Containers
- ACS erhaelt nur den privaten CA-Key und das zugehoerige CA-Zertifikat, damit
  es das Serverzertifikat signieren kann
- FHEM bekommt nur das oeffentliche CA-Zertifikat oder die CA-Chain-Datei
- wenn du eine Intermediate-CA nutzt, kannst du den Root-Key komplett aus dem
  ACS-Container heraushalten
- das Verfahren ist funktional identisch zu `Eigene Root-CA`, aber die
  Schluesselverwaltung bleibt bei deiner PKI

Beispiel mit extern erzeugter privater CA:

```yaml
services:
  alexa-cookie-service:
    environment:
      TLS_ENABLED: "true"
      TLS_CA_KEY_FILE: /data/tls/private-ca.key
      TLS_CA_CERT_FILE: /data/tls/private-ca.crt
      TLS_SERVER_KEY_FILE: /data/tls/server.key
      TLS_SERVER_CERT_FILE: /data/tls/server.crt
    volumes:
      - ./data:/data
      - ./private-ca/private-ca.key:/data/tls/private-ca.key:ro
      - ./private-ca/private-ca.crt:/data/tls/private-ca.crt:ro

  fhem:
    volumes:
      - ./private-ca/private-ca.crt:/opt/fhem/ssl/private-ca.crt:ro
```

Dann muss die FHEM-Seite wieder explizit dieser CA vertrauen:

```text
attr AlexaCookieService sslArgs SSL_ca_file=/opt/fhem/ssl/private-ca.crt,SSL_verify_mode=1
```


## Datenhaltung

Der komplette Persistenzzustand wird unter `STATE_FILE` gespeichert.
Dieser Zustand ist die Grundlage für spätere Refreshes.

Zusätzlich schreibt der Service:
- `METADATA_FILE` – Metadaten zum letzten Update

Für den empfohlenen FHEM-Flow gilt:

- `GET /api/cookie` liefert die Export-JSON im Response.
- FHEM schreibt diese JSON lokal in die Datei, die `echodevice` erwartet.
- Danach kann der vorhandene `echodevice_NPMWaitForCookie($hash)`-Pfad ausgelöst werden.
- Bei TLS-Betrieb muss FHEM der lokalen CA vertrauen, statt die Pruefung abzuschalten.
- Wenn ACS und FHEM getrennt laufen, lege den CA-Pfad vorab fest und mache `/data/tls/ca.crt` für FHEM lesbar.

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
- Nutze `TLS_ENABLED=true` als dokumentierten Standardbetrieb, besonders wenn FHEM und der Service getrennt laufen.
- Stelle sicher, dass FHEM die CA-Datei lesen kann und die Zertifikatspruefung aktiviert bleibt.
- Ein Reverse Proxy kann zusaetzlich sinnvoll sein, ersetzt aber keine klare TLS-Konfiguration im Service.
- Lege `/data` auf ein persistentes Volume.

## Bekannte Grenzen

- Amazon kann Login-Flows jederzeit ändern.
- MFA, Captcha und Regionseffekte bleiben möglich.
- Der initiale Login ist absichtlich browsergestützt; das ist robuster als ein erzwungener Headless-Flow.

## Empfohlener Importfluss

Für getrennte Hosts oder Deployments ohne Shared Volume ist der empfohlene Ablauf:

1. `GET /api/status` aus FHEM ueber die HTTPS-URL aufrufen, damit der Servicezustand bei Bedarf automatisch per Refresh aktualisiert wird.
2. `GET /api/cookie` abrufen.
3. Die Response lokal in die von `echodevice` erwartete Datei schreiben.
4. `echodevice_NPMWaitForCookie($hash)` aus dem FHEM-seitigen Code triggern.

`POST /api/cookie/refresh` und `save=<filename>` bleiben als manuelle Legacy-/Fallback-Optionen erhalten, sind aber nicht der empfohlene Standardpfad.
