# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Release tags have no leading `v` (Obsidian requirement).

## [Unreleased]

## [0.1.0] - 2026-10-15

First release.

### Added

- Display switch per note: Original, English, German (header button, status bar, commands).
- Translation through any OpenAI-compatible Chat Completions endpoint, with presets for LM Studio, OpenAI, OpenRouter and the Meta Model API.
- Sentence-level translation cache in a visible, syncable `_Translations/` folder, keyed by content hash.
- Protection of links, embeds, URLs, tags, block ids, footnotes, code, math and comments with placeholders.
- `<<n>> {lang}` line output format (tolerant of small models) and an optional JSON mode.
- Source-language reporting and local detection: sentences already in the target language are never requested.
- Reading view and Live Preview display, with a "decode" animation when translations appear.
- Editing in translated views: direct typing between sentences, edit sessions with a banner, delete notice with Undo, restore of replaced originals.
- API key in Obsidian's secret storage; settings for model, temperature, max tokens, extra headers and request parameters, timeouts, concurrency, retries and batch size.
- Glossary, abbreviation list, wikilink alias option, excluded and include-only folders, configurable cache folder with "Add exclusion".
- Bulk "Translate folder" with a token and cost estimate.
- View-only mode on mobile (no requests, no key).
- English and German interface.

[Unreleased]: https://github.com/CodingJinxx/transparent-translate/compare/0.1.0...HEAD
[0.1.0]: https://github.com/CodingJinxx/transparent-translate/releases/tag/0.1.0
