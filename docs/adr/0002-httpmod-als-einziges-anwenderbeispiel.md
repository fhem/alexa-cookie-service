# 0002: HTTPMOD als einziges Anwenderbeispiel

## Status

Akzeptiert

## Kontext

Der Service wird in FHEM typischerweise ueber ein HTTP-basiertes Muster
angebunden. Bisher koennen mehrere Beispielpfade beschrieben oder historisch
mitgefuehrt werden, etwa at/notify-Kombinationen, Shell-Skripte oder
curl-basierte Alternativen.

Diese Varianten erhoehen den Pflegeaufwand und erzeugen unterschiedliche
Erwartungen an Fehlerbehandlung, Authentifizierung, Zeitverhalten und
Kompatibilitaet. Fuer Anwender ist dadurch schwerer erkennbar, welcher Weg der
empfohlene und getestete Integrationspfad ist.

## Entscheidung

Als dokumentiertes Anwenderbeispiel wird nur noch HTTPMOD gepflegt.

Andere Beispielpfade, insbesondere at/notify, Shell-Skripte und curl-basierte
Alternativen, werden aus der Anwenderdokumentation entfernt oder nicht weiter
ausgebaut. Sie gelten nicht mehr als gepflegte Beispiele fuer die Nutzung des
Services.

## Konsequenzen

Die Dokumentation wird kuerzer und fokussierter. Pflege, Tests und fachliche
Erklaerungen koennen sich auf einen Integrationspfad konzentrieren. Neue
Anwender erhalten eine eindeutige Empfehlung.

Bestehende lokale Loesungen auf Basis von at/notify, Shell-Skripten oder curl
werden durch diese Entscheidung nicht technisch abgeschaltet. Sie sind jedoch
keine dokumentierten oder unterstuetzten Beispielpfade mehr.

## Migration und Kompatibilitaet

Anwender mit bestehenden alternativen Setups koennen diese weiterhin auf eigene
Verantwortung betreiben. Fuer dokumentierte Nutzung, Fehleranalyse und
zukuenftige Beispiele ist eine Migration auf HTTPMOD vorgesehen.
