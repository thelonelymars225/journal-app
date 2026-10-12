# Journal

A private journal that files each entry under life topics (Career & Work, Love &
Relationships, Family, Health, Money, and more) automatically, using a small
language model that runs on your own computer. Every entry shows when it was
created and when it was last edited.

![Journal](screenshot.png)

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
cd journal-app
npm install
npm run dev
```

`npm install` also downloads the topic model (about 25 MB) into
`public/models/`, once. From then on it is part of the app: it ships inside the
build and the Electron app, and sorting works fully offline. If that download
is skipped or fails, run `npm run fetch-model` later; until then the app sorts
by keywords.

Then open the address it prints (usually http://localhost:5173).

### As a desktop app (Electron)

```bash
npm run electron
```

This builds the web app and opens it in its own window. Entries live in the
app's own storage, separate from your browser.

## Mac app

Every push to `main` builds the Mac app on GitHub (see
`.github/workflows/mac.yml`). To download it, open the repository's
**Actions** tab, pick the latest "Build Mac app" run, and download
**Journal-mac** at the bottom. Inside are two disk images:

- `Journal-<version>-arm64.dmg` for Apple Silicon Macs (M1 and newer)
- `Journal-<version>-x64.dmg` for Intel Macs

Pushing a tag like `v0.1.0` also attaches both to a GitHub Release.

Open the .dmg and drag Journal into Applications. The topic model is already
inside, so it works offline from the first launch.

**First launch (one time only).** The app isn't signed with an Apple developer
certificate yet, so macOS blocks it the first time:

1. Open Journal from Applications. macOS says it can't verify the developer; click **Done**.
2. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the Journal message. Confirm with your password.
   (On macOS 14 or older you can instead right-click Journal in Applications and choose **Open**.)
3. If macOS says the app "is damaged", run this once in Terminal and open it again:
   `xattr -cr /Applications/Journal.app`

After that it opens normally.

To build the .dmg on a Mac yourself: `npm install` then `npm run dist:mac`;
the files land in `release/`.

## How the sorting works

- When you stop typing for about two seconds, the entry is sent to a small
  zero-shot classifier (`Xenova/mobilebert-uncased-mnli`, 8-bit quantized,
  about 25 MB) running in a background worker in the app. It scores how well
  the entry fits each topic's description and files it under the ones that
  clearly fit (up to 3).
- The model and the runtime that executes it (ONNX Runtime WebAssembly, about
  21 MB, 5 MB compressed) are bundled with the app. The app makes no network
  requests at all, so your journal text never leaves your computer.
- Until the model has loaded (or if it isn't bundled), entries are sorted by
  simple keyword matching, and re-sorted by the model once it is ready.
- **New topic suggestions:** in the background the model also checks your
  entries against a pool of extra life topics (Travel, Pets, Faith, Grief &
  Loss, Goals & Plans, and more, in `src/topics.js`). When 3 or more entries
  clearly fit one that isn't in your list, a card in the sidebar offers it.
  "Add topic" adds it and files those entries under it; "Not now" hides that
  suggestion. You can turn suggestions off in settings.
- Add or remove a topic on an entry yourself and automatic sorting stops for
  that entry. "Re-sort" hands it back to the model.
- Topics are editable under **Topics & settings**: rename them, change what
  they cover, add new ones, or delete them. "Re-sort all entries" applies the
  change to everything you've written. The sensitivity slider controls how
  readily an entry gets filed under more than one topic.

## Your data

Entries are stored in IndexedDB on this computer only. Use **Export backup**
in settings to save a JSON copy, and **Import backup** to restore it.

## Files

- `src/main.js` — the interface: sidebar, entry list, editor, settings
- `src/db.js` — local storage (IndexedDB)
- `src/topics.js` — default topics and the keyword fallback
- `src/classifier.js`, `src/classifier.worker.js` — the on-device model
- `scripts/fetch-model.mjs` — puts the model files into `public/models/`
- `electron/main.cjs` — desktop wrapper
- `build/` — app icon; `.github/workflows/mac.yml` — builds the Mac app
