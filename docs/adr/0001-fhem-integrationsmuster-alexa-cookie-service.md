# ADR-0001: FHEM-Integrationsmuster fuer alexa-cookie-service

**Date**: 2026-06-13
**Status**: proposed
**Deciders**: Projektmaintainer, FHEM-/echodevice-Beteiligte

## Context

`alexa-cookie-service` kapselt Login, Refresh und Export der Alexa-Cookie-Daten als separater Node.js-Service. `37_echodevice.pm` bleibt weiterhin das FHEM-Modul, das den Cookie konsumiert. Die Integration muss deshalb entweder ueber bestehende FHEM-Mittel, ueber Aenderungen an `echodevice`, oder ueber ein neues Integrationsmodul erfolgen.

Wichtige Entscheidungskriterien sind Einfachheit fuer Anwender, Supportaufwand, Entwicklungskomplexitaet, Stabilitaet und Robustheit, Wartungsaufwand, Umsetzbarkeit inklusive Abhaengigkeit von anderen Entwicklern, sowie Zukunftssicherheit.

## Decision

Kurzfristig wird eine dokumentierte Integration ueber bestehende FHEM-Mittel unterstuetzt, insbesondere `HTTPMOD` fuer die REST-Kommunikation sowie definierte Trigger fuer Refresh und Import.

Als Zielarchitektur wird ein eigenes FHEM-Modul `AlexaCookieService` mit wiederverwendbaren Perl-Packages bevorzugt. Das Modul stellt die FHEM-Bedienoberflaeche bereit, waehrend die eigentliche Integrationslogik in Packages liegt. Diese Packages koennen spaeter auch von `37_echodevice.pm` verwendet werden, falls eine native Integration akzeptiert wird.

Monkey-Patching oder das Ueberschreiben interner `echodevice`-Funktionen ueber `99_MyUtils` wird nicht empfohlen.

## Bewertungsmatrix

Score: `5 = sehr gut`, `1 = schlecht`.

| Variante | Anwender | Support | Entwicklung | Robustheit | Wartung | Umsetzbarkeit | Zukunft |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1. `HTTPMOD` ohne `echodevice`-Aenderung | 3 | 3 | 4 | 4 | 4 | 5 | 4 |
| 2. Native Aenderung oder Patch in `echodevice` | 5 | 5 | 4 | 5 | 5 | 3 | 5 |
| 3. `99_MyUtils` plus `at`/`notify` | 2 | 2 | 3 | 3 | 2 | 5 | 2 |
| 4. Ueberschreiben von `echodevice`-Funktionen | 1 | 1 | 2 | 1 | 1 | 4 | 1 |
| 5. Eigenes FHEM-Modul mit wiederverwendbaren Packages | 4 | 4 | 3 | 5 | 5 | 4 | 5 |
| 6. FHEMWEB/apiWeb Callback vom Service nach FHEM | 3 | 2 | 3 | 3 | 3 | 4 | 3 |
| 7. MQTT2 Bridge | 3 | 3 | 3 | 4 | 3 | 3 | 4 |
| 8. DOIF-only Integration | 2 | 2 | 4 | 3 | 2 | 5 | 3 |
| 9. JsonMod/readingsProxy/dummy als Fassade | 3 | 3 | 4 | 3 | 3 | 4 | 3 |
| 10. Externer Orchestrator oder Sidecar | 2 | 1 | 4 | 3 | 2 | 4 | 2 |

## Alternatives Considered

### Alternative 1: `HTTPMOD` ohne `echodevice`-Aenderung

- **Pros**: Sofort lieferbar, nutzt etablierte FHEM-Mittel, keine Abhaengigkeit vom `echodevice`-Maintainer, passt zur vorhandenen REST-API.
- **Cons**: Anwender muessen mehrere Bausteine konfigurieren: `HTTPMOD`, Token, dynamischen Exportnamen, `at`, `notify` und Importaufruf.
- **Why not as target**: Gute kurzfristige Loesung, aber fuer Anwender nicht so einfach wie eine native oder modulbasierte Integration.

### Alternative 2: Native Aenderung oder Patch in `echodevice`

- **Pros**: Beste Anwendererfahrung, zentrale Fehlerbehandlung, geringer Konfigurationsaufwand, langfristig sauber.
- **Cons**: Abhaengig von Review, Akzeptanz und Release-Zeitpunkt des `echodevice`-Maintainers.
- **Why not as first step**: Fachlich sehr attraktiv, aber nicht vollstaendig selbst kontrollierbar.

Diese Option wird durch Alternative 5 deutlich einfacher, wenn die Integrationslogik bereits als wiederverwendbare Packages existiert. `echodevice` muesste dann nicht die gesamte REST-, Token-, Timeout- und Response-Logik selbst implementieren, sondern koennte auf ein vorhandenes Package zugreifen.

### Alternative 3: `99_MyUtils` plus `at`/`notify`

- **Pros**: Sofort moeglich, kein neues Modul notwendig, gut fuer lokale Tests und Prototypen.
- **Cons**: Code muss kopiert werden, Installationen driften auseinander, Fehlerbilder sind schwerer zu supporten.
- **Why not**: Als Uebergang brauchbar, aber nicht als empfohlenes Integrationsmuster fuer breitere Nutzung.

### Alternative 4: Ueberschreiben von `echodevice`-Funktionen ueber `99_MyUtils`

- **Pros**: Erlaubt tiefe Eingriffe ohne Upstream-Patch.
- **Cons**: Haengt an internen Funktionsnamen und Implementierungsdetails von `echodevice`, bricht leicht bei Updates, ist schwer debugbar.
- **Why not**: Zu fragil und supportintensiv. Nicht als unterstuetztes Muster geeignet.

### Alternative 5: Eigenes FHEM-Modul mit wiederverwendbaren Packages

- **Pros**: Klare FHEM-Oberflaeche mit `set refresh`, `get loginUrl`, Status-Readings und optionalem Import-Trigger. Die Integrationslogik kann sauber getestet, dokumentiert und spaeter von `echodevice` wiederverwendet werden.
- **Cons**: Hoeherer Entwicklungsaufwand als reine FHEM-Konfiguration; Package-Grenzen muessen bewusst entworfen werden.
- **Why chosen as target**: Beste selbst kontrollierbare Zielarchitektur. Sie verbessert kurzfristig Supportbarkeit und bereitet gleichzeitig eine spaetere native `echodevice`-Integration vor.

Moegliche Struktur:

```text
FHEM/
  98_AlexaCookieService.pm
lib/
  FHEM/
    AlexaCookieService/
      Client.pm
      EchodeviceImport.pm
      State.pm
```

`98_AlexaCookieService.pm` waere die FHEM-spezifische Device- und UI-Schicht. `Client.pm` kapselt die REST-API des Services, `EchodeviceImport.pm` kapselt Exportnamen, Pfadlogik und Import-Trigger, und `State.pm` normalisiert Status- und Fehlerdaten.

### Alternative 6: FHEMWEB/apiWeb Callback vom Service nach FHEM

- **Pros**: Der Service kann FHEM nach erfolgreichem Export aktiv triggern.
- **Cons**: Erhoeht Sicherheits- und Konfigurationsaufwand durch Auth, CSRF, `allowed`, Netzwerkfreigaben und TLS-Fragen.
- **Why not**: Valide, aber supportlastiger und sicherheitssensibler als eine Pull- oder Modul-basierte Integration.

### Alternative 7: MQTT2 Bridge

- **Pros**: Entkoppelt, eventbasiert, FHEM-typisch bei vorhandener MQTT-Infrastruktur.
- **Cons**: Erfordert MQTT2-Setup oder Broker und zusaetzliche MQTT-Unterstuetzung im Service.
- **Why not**: Gute Erweiterungsoption, aber nicht minimal und nicht fuer alle Anwender vorhanden.

### Alternative 8: DOIF-only Integration

- **Pros**: Kann mehrere `at`/`notify`/Perl-Fragmente in einem Device buendeln.
- **Cons**: DOIF-Syntax und eingebettete Perl-/HTTP-Logik sind fuer Support weiterhin anspruchsvoll.
- **Why not**: Besser als lose Fragmente, aber keine saubere Integrationsschnittstelle.

### Alternative 9: JsonMod, readingsProxy oder dummy als Fassade

- **Pros**: Gut fuer Statusanzeige, UI-Fassade oder einfache Bedienung.
- **Cons**: Kein vollstaendiger Transport- und Importpfad fuer `echodevice`.
- **Why not**: Eher Ergaenzung als Hauptintegration.

### Alternative 10: Externer Orchestrator oder Sidecar

- **Pros**: Niedriger Entwicklungsaufwand im FHEM-Code, flexibel ausserhalb von FHEM.
- **Cons**: Zusaetzliche Runtime und Fehlerquelle, hoher Supportaufwand, Logik liegt ausserhalb der FHEM-Konfiguration.
- **Why not**: Fuer einzelne Spezialinstallationen moeglich, aber keine gute Standardarchitektur.

## Consequences

### Positive

- Die kurzfristige Integration kann ohne Aenderung an `echodevice` ausgeliefert werden.
- Die Zielarchitektur bleibt selbst kontrollierbar und muss nicht auf einen Upstream-Patch warten.
- Wiederverwendbare Packages reduzieren spaetere Doppelimplementierung.
- Eine native `echodevice`-Integration wird einfacher, weil vorhandene Packages genutzt werden koennen.
- REST-Kommunikation, Tokenhandling, Timeout-Logik, Response-Parsing und Fehlernormalisierung koennen an einer Stelle gepflegt werden.

### Negative

- Das Package-basierte FHEM-Modul ist aufwendiger als eine reine Beispielkonfiguration.
- Es entsteht ein eigener Wartungsgegenstand im FHEM-Umfeld.
- Solange `echodevice` nicht nativ integriert ist, bleibt der Import an bestehende interne Mechanismen wie `echodevice_NPMWaitForCookie()` gebunden.

### Risks

- Interne `echodevice`-Details koennen sich aendern.
  Mitigation: keine Monkey-Patches empfehlen; Importlogik isolieren; langfristig native Integration oder stabile Schnittstelle anstreben.
- Feste `NR`-Dateinamen brechen nach `rereadcfg` oder Konfigurationsaenderungen.
  Mitigation: Exportnamen immer dynamisch aus der aktuellen `NR` des `echodevice`-Devices ableiten.
- API- und Token-Konfiguration koennen Support verursachen.
  Mitigation: klare Defaults, Status-Readings, aussagekraeftige Fehlermeldungen und minimaler dokumentierter Beispielpfad.

## References

- Architecture Decision Records Skill: <https://github.com/affaan-m/ECC/blob/main/skills/architecture-decision-records/SKILL.md>
- FHEMWEB/apiWeb: <https://wiki.fhem.de/wiki/FHEMWEB>
- MQTT2 Praxisbeispiele: <https://wiki.fhem.de/wiki/MQTT2-Module_-_Praxisbeispiele>
- DOIF: <https://wiki.fhem.de/wiki/DOIF>
- JsonMod: <https://wiki.fhem.de/wiki/JsonMod>
