## Welcome

Transparent Translate shows any note in **Original**, **English**, **German** or **Dutch**. It only changes what you *see*: the file on disk is never rewritten by a language switch or a translation.

- Translations come from a language model you choose (a local one such as LM Studio, or a service such as OpenAI, OpenRouter or the Meta Model API).
- Notes are translated sentence by sentence and only when you switch a note to another language. Each sentence is translated once and then cached.
- Links, code, math, tags and other syntax are protected: they are never sent for rewriting.
- You can open **Settings → Transparent Translate** at any time, and this guide again with the command **Open user guide**.

## Set up

1. Open **Settings → Transparent Translate**.
2. Pick a **Provider**. It fills in the base URL (every field stays editable).
3. Enter the **Model**, or select **Fetch models** and choose one.
4. Under **API key**, create a secret with your key and select it. Local servers usually need no key.
5. Select **Test**. It translates "Guten Morgen" and shows the result, the time it took and the tokens used.
6. Optional: select **Add exclusion** so the cache folder does not show up in search and the graph.

If you use a reasoning model, add `{"reasoning_effort": "low"}` under **Extra request parameters**: translation does not need deep reasoning, and reasoning tokens cost money.

## Switch the language of a note

- Select the **language button** in the note header, or the `OG · EN · DE · NL` item in the status bar, to cycle through Original, English, German and Dutch.
- Or run **Show original**, **Show English**, **Show German** or **Show Dutch** from the command palette.
- The first switch requests the translations of the note; later switches are instant, because everything is cached.
- Sentences that are already in the target language are recognised and never sent.
- While a sentence is being translated it has a dotted underline. A red dotted underline means the translation failed; hover it to see why.
- The letters briefly "decode" into the new text. Turn this off with **Animate translations** in the settings.

Each note remembers its own language for the session. **Default display language** in the settings sets what new notes open in.

## Edit a translated note

Editing works as usual, with a few rules that keep your file safe:

- **Type between sentences**, at the end of a block or on a new line: the text goes straight into the file, in the language you type.
- **Click a translated sentence**, or start typing over one: an inline editor opens. Nothing is written yet.
- `Enter`, or clicking elsewhere, replaces the original sentence in the file with what you wrote. `Esc` cancels.
- `Ctrl/Cmd+Shift+Enter` switches to Original and puts the cursor in that sentence, if you would rather edit the original.
- **Delete** a translated sentence: it is removed without a dialog and a notice offers **Undo**.
- **Restore replaced original…** brings back a sentence that an edit replaced or deleted, even after the undo history is gone.
- **Copy original text** copies the selection (or the note) as it is on disk. Normal copy copies what you see.

## Fix and teach translations

Models pick plausible but wrong words for subject terms. The glossary lets you settle a term once, and the plugin keeps using it.

1. **Right-click** a translated sentence and choose **Fix translation…** (or run **Fix the translation of a sentence…**, which also works on mobile).
2. **Click the term** in the original. Click a neighbouring word to select a phrase.
3. Type **what it should be**. Optionally mark words in the translation that are wrong.
4. Choose **where it applies**: a folder (suggested), the note, a frontmatter property such as `course: SYS`, a tag, or the whole vault. The most specific entry wins, so the same word can mean different things in different subjects.
5. **Save.** Sentences that contain the term are translated again. The notice has **Undo**.

More tools:

- **Review terms in this note…** asks the model which terms it was unsure about. You settle the ones you care about in one dialog.
- **Manage translation glossary** lists, edits and deletes entries. Besides "translate as" there are "never translate as" (a word you know is wrong) and "do not translate". A scope can also have a short **subject area** such as "German university course notes".
- A term also matches inside longer words: `Schein` finds `Scheinkriterien`. Short terms like `LP` match only as whole words.
- When an entry changes, only the sentences containing that term are translated again. Switch this to manual under **Settings → Glossary**, and use **Update translations affected by glossary changes**.

## File and folder names

Under **Settings → Transparent Translate → File and folder names** (or with the commands **Show file and folder names in …**) the file explorer, tab titles, note titles and breadcrumbs can show translated names.

- Only the display changes. Files and folders are never renamed, and while you rename something you see its real name.
- Search, the quick switcher, links and the explorer's sort order still use the real names, so translated rows can look unsorted.
- If two items in a folder would get the same translated name, both keep their originals.
- Names are only requested for what is on screen. They are cached in `_Translations/_names.md`.

## Translate a whole folder

**Translate folder…** counts what is missing, shows a token and cost estimate (enter your prices under **Cost estimate** in the settings) and asks before sending anything. Use it to fill the cache for a course folder before you go offline or switch to your phone.

## Where things are stored

- **Translations:** in a visible folder, `_Translations/` by default, one note per translated note. They are plain JSON behind a "generated" warning, as regular notes, so Obsidian Sync carries them to your other devices.
- **Names:** `_Translations/_names.md`.
- **Glossary:** `Translation glossary.md` in the vault root. It is outside the cache folder, so **Clear the entire translation cache** never deletes what you taught the plugin.
- Hide the cache from search and the graph with **Add exclusion** in the settings. Treat `_Translations/` as generated output in other tools.
- Renaming or deleting a note moves or deletes its cache note. **Prune unused translations** removes sentences that no longer occur in their notes.

## On your phone

On mobile the plugin is **view-only**: switch between Original, English, German and Dutch and read the translations that were generated on a computer and synced. Sentences without a cached translation stay in the original language. No requests are made and no key is needed. You can still fix terms in the glossary; the new translations appear once a computer has updated them.

## Privacy and cost

- When you switch a note, the text of its sentences, the note title and the glossary entries that match them are sent to the provider you configured. With a local server nothing leaves your computer.
- With **File and folder names** on, the visible names (without extension) and their folder are sent too.
- Frontmatter and code blocks are never sent. Links, code, math and tags are replaced by placeholders first.
- The API key lives in Obsidian's secret storage, not in a settings file. The plugin has no telemetry.
- Cloud providers usually charge per token. Cached sentences are never paid for twice.

## Troubleshooting

- **Nothing happens when I switch:** check that a provider and model are set under **Settings → Transparent Translate** and select **Test**. A notice shows connection errors.
- **"Translation is not available":** the endpoint cannot be reached (is your local server running, are you online?) and this note has no translation yet, so there is nothing to show. Notes that are already translated can still be switched, and the check is repeated every time you try.
- **A sentence stays in the original language:** a dotted underline means it is still being translated; a red one means it failed (hover for the reason). Switch the note away and back to try again, or run **Re-translate this note**.
- **A translation is wrong:** use **Fix translation…**. For everything of a note, **Re-translate this note** drops its cache.
- **No animation:** check **Animate translations** in the settings.
- **I changed my provider or model:** old translations stay in the cache. Use **Re-translate this note** or **Clear the entire translation cache**.
- Turn on **Debug logging** in the settings and check the developer console if something looks wrong.

## All commands

No command has a default hotkey: bind your own under **Settings → Hotkeys**.

- **Show original / Show English / Show German / Show Dutch**, **Cycle display language**
- **Re-translate this note**, **Translate folder…**
- **Fix the translation of a sentence…**, **Review terms in this note…**, **Manage translation glossary**, **Update translations affected by glossary changes**
- **Show file and folder names in original / English / German / Dutch**
- **Copy original text**, **Restore replaced original…**
- **Clear translation cache for this note**, **Clear the entire translation cache**, **Prune unused translations**
- **Open user guide**
