---
tags: [vorlesung]
kurs: INF-K
---
# Lektion 1: Laufzeitanalyse

Heute geht es um die Laufzeit von Algorithmen. We count steps, not seconds! Das ist z. B. bei Karel wichtig.

Die Laufzeit ist:

$$
T(n) = 3n + 2
$$

- Jeder Schritt kostet $1$ Zeiteinheit.
- Loops multiply the cost, d. h. eine Schleife mit $n$ Durchläufen kostet $n$ Schritte.
	- Verschachtelte Schleifen: $n^2$
- Siehe [[Woche 1 (14.10.-20.10.)|Woche 1]] und #INF-K.

| Begriff | Bedeutung |
| --- | --- |
| Laufzeit | Anzahl der Schritte |
| Big O | Obere Schranke für das Wachstum |

> [!note] Merke
> Konstanten fallen in der O-Notation weg. Mehr dazu in BlueJ.

```java
for (int i = 0; i < n; i++) { move(); }
```

Fragen bitte über Particify stellen. ^frage1
