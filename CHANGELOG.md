# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Release tags have no leading `v` (Obsidian requirement).

## [Unreleased]

## [0.2.2] - 2026-10-15

### Fixed

- Live Preview: a sentence that starts with bold text (`**Folien:** …`), for example the second line of a paragraph or a bullet, could be shown as an empty line or empty bullet in a translated mode. Obsidian hides the `**` markers with its own decorations, which swallowed the start of the translation. Translations now take precedence. The translation itself was always correct.

## [0.2.1] - 2026-10-15

### Changed

- The decode animation no longer follows the system's reduced-motion setting; the **Animate translations** toggle is the only switch.
- The animation plays between all modes: Original ↔ English ↔ German, including text that does not change (for example German text when switching to German) and back to the original, in Reading view and Live Preview.

### Fixed

- A sentence that starts with a link or code span after a full stop (`… steht in [[Notiz]]. `Datei.pdf` liegt …`) is no longer glued to the previous sentence.
- German text with English terms that a model reports as "mixed" is recognised as German when local detection is sure, so German mode keeps your wording instead of a rewrite (for example `Moore's Law` stays).
- After clearing or moving the translation cache, notes no longer stay stuck on "pending" until they are reopened.
- The translation prompt asks for consistent terms and for "mixed" only when a sentence really has phrases in both languages.

## [0.2.0] - 2026-10-15

### Added

- Optional translated file and folder names in the file explorer, tab titles, note titles and breadcrumbs (setting and commands "Show file and folder names in …"). Only the display changes; the real name is shown while renaming. Translations are cached in `_Translations/_names.md`.

### Fixed

- A bold, italic, highlighted or struck-through lead-in that ends in a period (`**Lead-in (ref).** Rest of the sentence.`) is no longer split inside the emphasis: the closing marker stays with the sentence it closes, so both sentences render with balanced markers. Affected sentences are translated again once.
- Sentence boundaries are never placed inside a placeholder, which previously could cut a highlight marker (`==text.==`) in two.

## [0.1.1] - 2026-10-15

### Fixed

- The language button in note headers is removed when the plugin is disabled.
- A renamed cache folder path is normalized like other vault paths.

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

[Unreleased]: https://github.com/CodingJinxx/transparent-translate/compare/0.2.2...HEAD
[0.2.2]: https://github.com/CodingJinxx/transparent-translate/compare/0.2.1...0.2.2
[0.2.1]: https://github.com/CodingJinxx/transparent-translate/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/CodingJinxx/transparent-translate/compare/0.1.1...0.2.0
[0.1.1]: https://github.com/CodingJinxx/transparent-translate/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/CodingJinxx/transparent-translate/releases/tag/0.1.0
