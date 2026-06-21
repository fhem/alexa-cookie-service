# 0003: Lokaler FHEM-Cookie-Export ohne Volume-Mount

## Status

Akzeptiert

## Kontext

`37_echodevice.pm` importiert Cookie-Daten aus einer Datei im FHEM-Dateisystem.
Der `alexa-cookie-service` laeuft dagegen als eigener Container und besitzt sein
eigenes Dateisystem. Ein gemeinsames Volume zwischen Service und FHEM koppelt
diese Container direkt aneinander und funktioniert nur, wenn beide Container auf
demselben Docker-Host laufen und denselben Pfad konsistent eingebunden haben.

Das erschwert Setups mit getrennten Hosts, unterschiedlichen Compose-Projekten,
Rootless Docker, Kubernetes oder anderen Laufzeitumgebungen. Ausserdem muss der
Service dann Schreibrechte in einen Pfad haben, der fachlich zum FHEM-Container
gehoert.

## Entscheidung

Der empfohlene Integrationspfad schreibt die Cookie-Exportdatei direkt in FHEM.

Der Service liefert den Export ueber `GET /api/cookie` als JSON-Response. Die
FHEM-seitige HTTPMOD-Integration nimmt diese Response entgegen, schreibt sie mit
Package-Hilfe lokal in das von `echodevice` erwartete Exportverzeichnis und
triggert danach den bestehenden `echodevice_NPMWaitForCookie($hash)`-Importpfad.

Das Package `FHEM::AlexaCookieService::EchodeviceImport` stellt dafuer die
Funktionen `write_cookie_export`, `write_cookie_export_for_device`,
`write_cookie_export_and_trigger_import` und
`write_cookie_export_and_trigger_import_for_device` bereit.

## Konsequenzen

Der normale Pfad benoetigt keinen Volume-Mount zwischen FHEM und
`alexa-cookie-service`. Der Service muss das FHEM-Dateisystem nicht kennen und
braucht keine Schreibrechte in FHEM-Pfade. Die Kopplung zwischen den Containern
bleibt auf HTTP und die FHEM-seitigen Package-Funktionen beschraenkt.

Die Exportdatei entsteht dort, wo `echodevice` sie liest: im FHEM-Container.
Dadurch bleibt der dynamische Dateiname auf Basis der aktuellen FHEM-`NR` lokal
auflosbar und der Import kann direkt nach erfolgreichem Schreiben gestartet
werden.

Die HTTP-Response von `/api/cookie` enthaelt Geheimnisse. Sie darf nicht breit
in Readings extrahiert oder geloggt werden. Die HTTPMOD-Konfiguration soll nur
gezielte, unkritische Readings ableiten und den kompletten Body an den lokalen
Import-Helper uebergeben.

## Verschluesselung und Schutz der Daten

Der Cookie-Export enthaelt Geheimnisse wie Cookie, CSRF-Wert und Refresh-Token.
Diese Daten werden im empfohlenen Pfad nur ueber HTTP vom Service an FHEM
uebertragen und danach als von `echodevice` erwartete JSON-Datei im
FHEM-Dateisystem abgelegt.

Eine zusaetzliche Verschluesselung dieser Exportdatei ist nicht Teil des
Standardpfads, weil `echodevice` die Datei im Klartext-JSON-Format liest. Eine
verschluesselte Datei wuerde deshalb entweder Aenderungen an `echodevice` oder
einen separaten Entschluesselungsschritt direkt vor dem Import erfordern. Beides
wuerde den Integrationspfad komplexer machen und waere nicht mehr kompatibel mit
dem bestehenden Importverhalten.

Der Schutz erfolgt deshalb ueber begrenzte Datenhaltung und Zugriffskontrolle:
Der Service schreibt nicht mehr direkt in FHEM-Pfade, der komplette Response-Body
wird nicht in Readings uebernommen, und die Exportdatei liegt nur lokal im
FHEM-Container. Der Exportpfad sollte nur fuer den FHEM-Benutzer lesbar sein und
nicht in Backups, Logs oder allgemein freigegebene Volumes gelangen. Wenn
Verschluesselung at rest benoetigt wird, sollte sie auf Host-, Dateisystem-,
Volume- oder Backup-Ebene umgesetzt werden.

Fuer den Transport zwischen FHEM und Service bleibt `AUTH_TOKEN` verpflichtend
empfohlen. In Netzen ausserhalb eines vertrauenswuerdigen Docker- oder
LAN-Segments soll der Zugriff zusaetzlich ueber TLS, zum Beispiel per Reverse
Proxy, abgesichert werden.

## Migration und Kompatibilitaet

Bestehende Setups mit Shared Volume und `save=<filename>` bleiben technisch
kompatibel. `POST /api/cookie/refresh?save=...` und `GET /api/cookie?save=...`
schreiben weiterhin unterhalb von `COOKIE_EXPORT_DIR`, wenn dieser Legacy-Pfad
bewusst genutzt wird.

Eine Migration auf den neuen Pfad ist optional, aber empfohlen. Anwender, die
migrieren, entfernen den gemeinsamen Export-Volume-Mount, rufen den Export per
HTTPMOD ab und lassen FHEM die Datei lokal schreiben. Das persistente
Service-Volume fuer `/data` bleibt weiterhin erforderlich, weil dort der
Registrierungszustand des Services liegt.

Der alte Volume-basierte Pfad ist damit ein Kompatibilitaets- und
Fallback-Pfad, nicht mehr der empfohlene Standard.
