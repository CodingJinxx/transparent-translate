# Security

## Reporting a vulnerability

Please report security problems privately through [GitHub security advisories](https://github.com/CodingJinxx/transparent-translate/security/advisories/new), not in public issues. Do not include real API keys or private notes.

## What the plugin does with your data

- Sentence text, the note title and the glossary are sent to the translation endpoint you configure, and only there.
- The API key is kept in Obsidian's secret storage. The plugin's settings file stores only the secret's name.
- Translations are written to the cache folder inside your vault. Nothing is written outside the vault.
- There is no telemetry.
