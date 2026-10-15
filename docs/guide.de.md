## Willkommen

Transparent Translate zeigt jede Notiz im **Original**, auf **Englisch** oder auf **Deutsch**. Es ändert nur, was du *siehst*: Die Datei auf der Festplatte wird durch einen Sprachwechsel oder eine Übersetzung nie umgeschrieben.

- Übersetzungen kommen von einem Sprachmodell deiner Wahl (lokal, etwa LM Studio, oder ein Dienst wie OpenAI, OpenRouter oder die Meta Model API).
- Notizen werden Satz für Satz übersetzt, und zwar erst, wenn du eine Notiz auf eine andere Sprache umschaltest. Jeder Satz wird einmal übersetzt und dann zwischengespeichert.
- Links, Code, Formeln, Tags und andere Syntax sind geschützt: Sie werden nie zum Umschreiben gesendet.
- Die Einstellungen findest du unter **Einstellungen → Transparent Translate**, diese Anleitung öffnest du jederzeit mit dem Befehl **Benutzeranleitung öffnen**.

## Einrichten

1. Öffne **Einstellungen → Transparent Translate**.
2. Wähle einen **Anbieter**. Er füllt die Basis-URL aus (jedes Feld bleibt änderbar).
3. Gib das **Modell** ein, oder wähle **Modelle laden** und suche eines aus.
4. Lege unter **API-Schlüssel** ein Geheimnis mit deinem Schlüssel an und wähle es aus. Lokale Server brauchen meist keinen Schlüssel.
5. Wähle **Testen**. Das Plugin übersetzt „Guten Morgen“ und zeigt Ergebnis, Dauer und verbrauchte Tokens.
6. Optional: Wähle **Ausschluss hinzufügen**, damit der Cache-Ordner nicht in Suche und Graph auftaucht.

Bei einem Reasoning-Modell trage unter **Zusätzliche Anfrageparameter** `{"reasoning_effort": "low"}` ein: Übersetzen braucht kein tiefes Nachdenken, und Reasoning-Tokens kosten Geld.

## Sprache einer Notiz wechseln

- Wähle den **Sprachknopf** im Notizkopf oder den Eintrag `OG · EN · DE` in der Statusleiste, um durch Original, Englisch und Deutsch zu schalten.
- Oder führe **Original anzeigen**, **Englisch anzeigen** oder **Deutsch anzeigen** in der Befehlspalette aus.
- Der erste Wechsel fordert die Übersetzungen der Notiz an; spätere Wechsel sind sofort da, weil alles zwischengespeichert ist.
- Sätze, die bereits in der Zielsprache sind, werden erkannt und nie gesendet.
- Ein Satz, der gerade übersetzt wird, hat eine gepunktete Unterstreichung. Rot gepunktet heißt: Die Übersetzung ist fehlgeschlagen; fahre darüber, um den Grund zu sehen.
- Die Buchstaben „dekodieren“ kurz zum neuen Text. Das schaltest du mit **Übersetzungen animieren** in den Einstellungen ab.

Jede Notiz merkt sich ihre Sprache für die Sitzung. **Standard-Anzeigesprache** in den Einstellungen legt fest, in welcher Sprache neue Notizen öffnen.

## Eine übersetzte Notiz bearbeiten

Bearbeiten funktioniert wie gewohnt, mit ein paar Regeln, die deine Datei schützen:

- **Zwischen Sätzen tippen**, am Ende eines Blocks oder in einer neuen Zeile: Der Text landet direkt in der Datei, in der Sprache, in der du schreibst.
- **Einen übersetzten Satz anklicken**, oder darüber tippen: Ein Inline-Editor öffnet sich. Noch wird nichts geschrieben.
- `Enter` oder ein Klick daneben ersetzt den Originalsatz in der Datei durch deinen Text. `Esc` bricht ab.
- `Strg/Cmd+Umschalt+Enter` wechselt zum Original und setzt den Cursor in diesen Satz, wenn du lieber das Original bearbeitest.
- Einen übersetzten Satz **löschen**: Er wird ohne Dialog entfernt, und eine Meldung bietet **Rückgängig** an.
- **Ersetztes Original wiederherstellen…** holt einen Satz zurück, den eine Bearbeitung ersetzt oder gelöscht hat, auch wenn der Rückgängig-Verlauf weg ist.
- **Originaltext kopieren** kopiert die Auswahl (oder die Notiz) so, wie sie auf der Festplatte steht. Normales Kopieren kopiert, was du siehst.

## Übersetzungen korrigieren und beibringen

Modelle wählen für Fachbegriffe oft plausible, aber falsche Wörter. Mit dem Glossar legst du einen Begriff einmal fest, und das Plugin bleibt dabei.

1. **Rechtsklick** auf einen übersetzten Satz und **Übersetzung korrigieren …** wählen (oder den Befehl **Übersetzung eines Satzes korrigieren …**, der auch mobil funktioniert).
2. Den **Begriff** im Original anklicken. Ein Nachbarwort anklicken, um eine Wortgruppe zu wählen.
3. Eintippen, **wie er übersetzt werden soll**. Optional falsche Wörter der Übersetzung markieren.
4. **Geltungsbereich** wählen: ein Ordner (Vorschlag), die Notiz, eine Frontmatter-Eigenschaft wie `course: SYS`, ein Tag oder der ganze Vault. Der spezifischste Eintrag gewinnt, dasselbe Wort kann also in verschiedenen Fächern Verschiedenes bedeuten.
5. **Speichern.** Sätze mit dem Begriff werden neu übersetzt. Die Meldung bietet **Rückgängig** an.

Weitere Werkzeuge:

- **Begriffe dieser Notiz prüfen …** fragt das Modell, bei welchen Begriffen es unsicher war. Die, die dir wichtig sind, entscheidest du in einem Dialog.
- **Übersetzungsglossar verwalten** listet Einträge auf, bearbeitet und löscht sie. Neben „Übersetzen als“ gibt es „Nie übersetzen als“ (ein Wort, von dem du weißt, dass es falsch ist) und „Nicht übersetzen“. Ein Geltungsbereich kann außerdem ein kurzes **Fachgebiet** haben, etwa „Notizen zu Informatikvorlesungen“.
- Ein Begriff passt auch innerhalb längerer Wörter: `Schein` findet `Scheinkriterien`. Kurze Begriffe wie `LP` passen nur als ganzes Wort.
- Ändert sich ein Eintrag, werden nur die Sätze mit diesem Begriff neu übersetzt. Stelle das unter **Einstellungen → Glossar** auf manuell und nutze **Von Glossaränderungen betroffene Übersetzungen aktualisieren**.

## Datei- und Ordnernamen

Unter **Einstellungen → Transparent Translate → Datei- und Ordnernamen** (oder mit den Befehlen **Datei- und Ordnernamen … anzeigen**) können Datei-Explorer, Tab-Titel, Notiztitel und Pfadleiste übersetzte Namen zeigen.

- Nur die Anzeige ändert sich. Dateien und Ordner werden nie umbenannt, und beim Umbenennen siehst du den echten Namen.
- Suche, Schnellwechsler, Links und die Sortierung des Explorers nutzen weiter die echten Namen, übersetzte Zeilen können also unsortiert wirken.
- Würden zwei Einträge eines Ordners denselben übersetzten Namen bekommen, behalten beide ihr Original.
- Namen werden nur für das angefordert, was auf dem Bildschirm ist. Sie liegen im Cache unter `_Translations/_names.md`.

## Einen ganzen Ordner übersetzen

**Ordner übersetzen…** zählt, was fehlt, zeigt eine Schätzung von Tokens und Kosten (deine Preise trägst du unter **Kostenschätzung** in den Einstellungen ein) und fragt nach, bevor etwas gesendet wird. Damit füllst du den Cache für einen Kursordner, bevor du offline gehst oder zum Handy wechselst.

## Wo alles liegt

- **Übersetzungen:** in einem sichtbaren Ordner, standardmäßig `_Translations/`, eine Notiz pro übersetzter Notiz. Sie sind einfaches JSON hinter einer „Generiert“-Warnung, als normale Notizen, damit Obsidian Sync sie auf deine anderen Geräte bringt.
- **Namen:** `_Translations/_names.md`.
- **Glossar:** `Translation glossary.md` im Vault-Stamm. Es liegt außerhalb des Cache-Ordners, **Gesamten Übersetzungs-Cache leeren** löscht also nie, was du dem Plugin beigebracht hast.
- Verberge den Cache mit **Ausschluss hinzufügen** vor Suche und Graph. Behandle `_Translations/` in anderen Werkzeugen als generierte Ausgabe.
- Wird eine Notiz umbenannt oder gelöscht, wandert oder verschwindet ihre Cache-Notiz. **Ungenutzte Übersetzungen entfernen** löscht Sätze, die in ihren Notizen nicht mehr vorkommen.

## Auf dem Handy

Auf dem Handy ist das Plugin **nur zum Ansehen**: Du schaltest zwischen Original, Englisch und Deutsch um und liest die Übersetzungen, die auf einem Computer erzeugt und synchronisiert wurden. Sätze ohne Übersetzung im Cache bleiben im Original. Es gibt keine Anfragen und keinen Schlüssel. Begriffe im Glossar kannst du trotzdem korrigieren; die neuen Übersetzungen erscheinen, sobald ein Computer sie aktualisiert hat.

## Datenschutz und Kosten

- Wenn du eine Notiz umschaltest, werden der Text ihrer Sätze, der Notiztitel und die dazu passenden Glossareinträge an den konfigurierten Anbieter gesendet. Bei einem lokalen Server verlässt nichts deinen Computer.
- Mit **Datei- und Ordnernamen** gehen auch die sichtbaren Namen (ohne Endung) und ihr Ordner an den Anbieter.
- Frontmatter und Codeblöcke werden nie gesendet. Links, Code, Formeln und Tags werden vorher durch Platzhalter ersetzt.
- Der API-Schlüssel liegt im geheimen Speicher von Obsidian, nicht in einer Einstellungsdatei. Das Plugin hat keine Telemetrie.
- Cloud-Anbieter rechnen meist pro Token ab. Zwischengespeicherte Sätze bezahlst du nie zweimal.

## Fehlersuche

- **Beim Umschalten passiert nichts:** Prüfe, ob unter **Einstellungen → Transparent Translate** Anbieter und Modell gesetzt sind, und wähle **Testen**. Eine Meldung zeigt Verbindungsfehler.
- **„Übersetzen ist nicht verfügbar“:** Der Endpunkt ist nicht erreichbar (läuft dein lokaler Server, bist du online?), und diese Notiz hat noch keine Übersetzung, es gibt also nichts anzuzeigen. Bereits übersetzte Notizen lassen sich weiter umschalten, und die Prüfung wird bei jedem Versuch wiederholt.
- **Ein Satz bleibt im Original:** Eine gepunktete Unterstreichung heißt, er wird noch übersetzt; eine rote, dass es fehlgeschlagen ist (fahre darüber für den Grund). Schalte die Notiz weg und zurück, um es erneut zu versuchen, oder führe **Diese Notiz neu übersetzen** aus.
- **Eine Übersetzung ist falsch:** Nutze **Übersetzung korrigieren …**. Für die ganze Notiz verwirft **Diese Notiz neu übersetzen** ihren Cache.
- **Keine Animation:** Prüfe **Übersetzungen animieren** in den Einstellungen.
- **Ich habe Anbieter oder Modell gewechselt:** Alte Übersetzungen bleiben im Cache. Nutze **Diese Notiz neu übersetzen** oder **Gesamten Übersetzungs-Cache leeren**.
- Schalte **Debug-Protokoll** in den Einstellungen ein und sieh in die Entwicklerkonsole, wenn etwas nicht stimmt.

## Alle Befehle

Kein Befehl hat eine Standard-Tastenkombination: Lege eigene unter **Einstellungen → Tastenkombinationen** fest.

- **Original / Englisch / Deutsch anzeigen**, **Anzeigesprache wechseln**
- **Diese Notiz neu übersetzen**, **Ordner übersetzen…**
- **Übersetzung eines Satzes korrigieren …**, **Begriffe dieser Notiz prüfen …**, **Übersetzungsglossar verwalten**, **Von Glossaränderungen betroffene Übersetzungen aktualisieren**
- **Datei- und Ordnernamen im Original / auf Englisch / auf Deutsch anzeigen**
- **Originaltext kopieren**, **Ersetztes Original wiederherstellen…**
- **Übersetzungs-Cache dieser Notiz leeren**, **Gesamten Übersetzungs-Cache leeren**, **Ungenutzte Übersetzungen entfernen**
- **Benutzeranleitung öffnen**
