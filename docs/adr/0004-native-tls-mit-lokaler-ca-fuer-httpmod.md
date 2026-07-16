# ADR-0004: Native TLS mit lokaler CA fuer HTTPMOD

**Date**: 2026-06-21
**Status**: proposed
**Deciders**: Projektmaintainer, FHEM-/echodevice-Beteiligte

## Kontext

`alexa-cookie-service` laeuft als eigener Node.js-Container und wird von FHEM
typischerweise ueber `HTTPMOD` angesprochen. Der relevante Transport betrifft
die Service-API auf Port `58080`, insbesondere `/api/status` und
`/api/cookie`. Diese Endpunkte liefern Geheimnisse wie Cookie, CSRF und
Refresh-Token.

Die bisherige Absicherung ueber einen Reverse Proxy ist operativ solide, aber
sie fuehrt zu einer zusaetzlichen Komponente. Fuer Docker-Umgebungen mit klar
benanntem Service und persisterndem `/data`-Volume kann TLS auch direkt im
Node-Prozess terminiert werden. Damit bleibt die Loesung klein und die
Konfiguration in Compose und HTTPMOD laesst sich auf einen Standardpfad
reduzieren.

Wichtige Kriterien sind:

- moeglichst wenig Wartung
- Docker-typisches Standardverhalten
- einfache Verifikation in `HTTPMOD`
- keine Abhaengigkeit von einem zusätzlichen Reverse-Proxy-Container

## Entscheidung

Die bevorzugte native TLS-Variante ist ein im Service verwaltetes
CA-Modell:

- ACS erzeugt bei Bedarf unter `/data/tls` eine lokale CA.
- Diese CA signiert ein Serverzertifikat fuer den Compose-Servicenamen
  `alexa-cookie-service`.
- Das Serverzertifikat ist 365 Tage gueltig.
- ACS erneuert CA nicht bei jedem Start, sondern nur wenn sie fehlt.
- ACS erneuert das Serverzertifikat beim Containerstart, wenn es fehlt,
  abgelaufen ist, bald ablaeuft oder nicht mehr zur Zielidentitaet passt.

Als Standard bleibt HTTP deaktivierbar, aber nicht die empfohlene
Transportvariante. Wenn `TLS_ENABLED=true` gesetzt ist, lauscht die
Service-API ueber HTTPS. Die Login-/Proxy-Funktion auf `58090` bleibt
separat und unveraendert.

## Varianten

### 1. Native TLS mit lokaler CA im Service

- **Pros**: eine Runtime, keine Proxy-Komponente, Compose-Standard mit
  stabiler Service-Identitaet, gutes Verhaeltnis aus Einfachheit und
  Transportabsicherung.
- **Cons**: ACS muss Zertifikate erzeugen und erneuern; HTTPMOD muss der CA
  explizit vertrauen.
- **Warum bevorzugt**: die kleinste Loesung, die trotzdem sauber verifiziert
  werden kann.

### 2. Native TLS mit self-signed Serverzertifikat ohne CA

- **Pros**: sehr wenig initiale Logik.
- **Cons**: Zertifikatswechsel ist fuer Clients schwerer sauber zu behandeln;
  HTTPMOD muss meist die strikte Pruefung lockern.
- **Warum nicht**: weniger stabil fuer einen dauerhaften Betrieb als ein
  lokales CA-Modell.

### 3. Native TLS mit bereitgestelltem Serverzertifikat

Diese Variante entspricht dem Betriebsmodus `TLS_SERVER_CERT_MODE=external`.
ACS verwendet dabei ein bereitgestelltes Leaf-Zertifikat samt privatem Key und
stellt kein neues Serverzertifikat aus.

- **Pros**: maximale Kompatibilitaet mit vorhandener PKI.
- **Cons**: ACS verwaltet keine Zertifikatskette selbst; Betriebsaufwand liegt
  voll beim Betreiber.
- **Warum nicht als Standard**: fuer Spezialfaelle gut, aber nicht die
  einfachste Standardloesung.

### 4. Native TLS mit bereitgestellter Root- oder Intermediate-CA

- **Pros**: gut fuer vorhandene PKI, Serverzertifikat kann im Service neu
  ausgestellt werden, ohne den Root-Key im Container zu benoetigen.
- **Cons**: etwas mehr PKI-Verstaendnis und saubere Trennung von Root-Key,
  Intermediate-Key und CA-Chain erforderlich.
- **Warum als Option**: guter Kompromiss fuer Betreiber mit eigener
  Zertifikatsstruktur, die ACS nur die Signaturrolle geben wollen.

Dabei gilt:

- der private Root-Key bleibt ausserhalb des ACS-Containers
- ACS erhaelt nur den fuer die Signatur benoetigten CA-Key und die CA-Chain
- FHEM vertraut nur dem oeffentlichen CA-Zertifikat oder der Chain-Datei
- diese Variante ist die passende Beschreibung fuer eine private PKI, die
  extern erzeugt und dem Service bereitgestellt wird

### 5. Reverse Proxy Sidecar

- **Pros**: sehr etabliert, Zertifikatsmanagement gut von der App getrennt.
- **Cons**: zusaetzlicher Container und zusaetzliche Konfiguration.
- **Warum nicht als bevorzugte Variante**: wartungsarm, aber nicht so klein
  wie native TLS.

### 6. mTLS

- **Pros**: starke clientseitige Authentisierung.
- **Cons**: hoehere Konfigurations- und Supportlast in FHEM und Docker.
- **Warum nicht**: fuer den Standardpfad zu schwergewichtig.

## HTTPMOD-Vertrauen

`HTTPMOD` soll im dokumentierten Standardfall der CA vertrauen, nicht die
Pruefung abschalten. Das heisst:

- `baseUrl` zeigt auf `https://alexa-cookie-service:58080`
- `sslArgs` verweist auf eine CA-Datei oder CA-Chain-Datei
- `SSL_verify_mode` bleibt auf Pruefung der Gegenstelle gesetzt
- der Hostname `alexa-cookie-service` wird als Zielidentitaet verwendet

Falls die Validierung absichtlich deaktiviert wird, ist das nur ein
Debug-/Notfallpfad und nicht der empfohlene Betrieb.

## Konsequenzen

- Keine zusaetzliche Reverse-Proxy-Komponente fuer den Standardfall.
- Zertifikate muessen persistent unter `/data/tls` abgelegt werden.
- Ein Neustart kann Zertifikate erneuern, ohne die Anwendung selbst zu
  veraendern.
- Die Dokumentation muss klar beschreiben, wie FHEM der lokalen CA vertraut.
- Die CA bleibt lokal im ACS-Volume, waehrend Serverzertifikate automatisch
  erneuert werden koennen.
- Betreiber mit externer PKI koennen Root- oder Intermediate-Material
  bereitstellen, ohne den Root-Key im FHEM- oder ACS-Standardpfad abzulegen.
- Betreiber mit einem externen Leaf-Zertifikat koennen `TLS_SERVER_CERT_MODE=external`
  nutzen und das Serverzertifikat samt Key vorgeben.

## Risiken

- Wenn `/data` nicht persistent ist, wechselt die CA und damit das Vertrauen
  fuer HTTPMOD.
  Mitigation: Persistenz als Muss fuer den TLS-Standardpfad dokumentieren.
- Wenn `HTTPMOD` die CA nicht korrekt referenziert, schlagen TLS-Requests fehl.
  Mitigation: ein explizites Beispiel fuer `sslArgs` und CA-Pfad dokumentieren.
- Wenn der Service-Name im Compose-Setup nicht stabil ist, passt die
  Zertifikatsidentitaet nicht.
  Mitigation: festen Netzwerk-Alias `alexa-cookie-service` als Standard
  vorgeben.

## References

- [ADR-0001: FHEM-Integrationsmuster fuer alexa-cookie-service](./0001-fhem-integrationsmuster-alexa-cookie-service.md)
- [ADR-0002: HTTPMOD als einziges Anwenderbeispiel](./0002-httpmod-als-einziges-anwenderbeispiel.md)
- [ADR-0003: Lokaler FHEM-Cookie-Export ohne Volume-Mount](./0003-lokaler-fhem-cookie-export-ohne-volume-mount.md)
