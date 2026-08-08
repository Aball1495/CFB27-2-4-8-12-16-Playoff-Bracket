# Packaging & Distribution Notes (for you, not beta testers)

## 1. Turning this into an .exe

`@electron/packager` (the actively-maintained scoped fork - the original
unscoped `electron-packager` has a known race condition on Node 24.x) is
a dev dependency, with a `package:win` script already in `package.json`.
I can't actually run this myself - packaging needs to download Electron's
prebuilt binaries, and my sandbox has no network access - so you'll need
to run it once on your own machine:

```
npm install
npm run package:win
```

That produces:

```
dist/CFB27 Playoff Editor-win32-x64/
    CFB27 Playoff Editor.exe
    ... (all bundled resources/dependencies)
```

That whole folder is the shippable app - beta testers just unzip it and
double-click the .exe. No Node, no npm, no install step on their end.

A few notes on the packaging command itself:
- It excludes the `Old stuff - Keep` folder (that video file is large and
  irrelevant to end users) and the `dist` output folder itself, so
  re-running the script doesn't recursively bundle its own previous
  output.
- It also excludes every `diagnose-*.mjs` script (the byte-hunting
  investigation tools - genuinely useful for a developer, no reason to
  ship them to beta testers) plus a few other dev-only files
  (`bracket-editor.mjs`, test/example config JSON, this file). If you add
  a new diagnostic script during future investigation, remember to add a
  matching `--ignore` flag for it in `package.json`, or it'll get bundled
  into the next beta build by accident.
- No icon is set. If you want a custom .exe icon, get a `.ico` file and
  add `--icon=path\to\icon.ico` to the `package:win` script in
  `package.json`.
- **`--asar=false` is required, not optional.** By default the packager
  bundles everything into a single compressed `app.asar` archive, which
  is read-only at runtime - and this app needs to *write*
  `teamConferenceOverrides.json` at runtime (that's the whole point of
  the "Save conference overrides" feature). Without this flag, saving
  overrides fails with a confusing `ENOENT` error that looks like a
  missing file, when it's actually "this path is inside a read-only
  archive." Already in the script, just don't remove it.
- This is unsigned. Windows SmartScreen will show a warning the first
  time anyone runs it ("Windows protected your PC" -> More info -> Run
  anyway). That's normal for an unsigned indie app and is called out in
  the beta README so testers aren't caught off guard. Code signing costs
  money and isn't worth it for a Discord beta.

If you ever want a proper installer (Start Menu entry, uninstaller,
auto-update support) instead of a portable folder, that's a bigger step
up - `electron-builder` instead of `@electron/packager` - but for a beta
among friends, the portable-folder approach is simpler and almost
certainly enough.

## 2. Can you just zip the raw project folder and upload it?

**Not the raw source folder** - if you zip the project as it exists in
this repo (source files + `node_modules`), beta testers would need Node.js
installed and would have to run `npm install` and `npm start` from a
terminal themselves. That's a fine workflow for you, but not for general
beta testers.

**Zip the *packaged* output instead** (the `dist/CFB27 Playoff
Editor-win32-x64` folder from step 1 above). That's fully self-contained
- testers don't need anything installed.

One real constraint: **Electron apps are large**, because each one bundles
its own copy of Chromium and Node. Expect the zipped packaged folder to
land somewhere in the 90-180MB range. Discord's attachment limit on a
free/non-boosted server is 25MB, so a direct upload will likely fail or
get silently rejected. Options, roughly best to simplest:

- **GitHub Releases** - free, versioned (great for iterating on beta
  builds), no practical size limit for a project this size (2GB/file
  cap). Just post the release link in Discord. This is probably the
  right long-term home for beta builds even outside this specific size
  problem.
- **Google Drive / Dropbox share link** - quick, no setup, works fine for
  a small beta group.
- If your Discord server happens to be boosted to Level 2+ (50MB cap) or
  Level 3 (100MB cap), a direct upload might just barely fit depending on
  final size - but I'd still lean toward GitHub Releases since you'll
  likely want to push updated builds as bugs get reported, and Releases
  gives you that for free with a clean version history.

## 3. The README

`README.md` in the project root is written for beta testers, not you -
it covers the run-it-and-use-it workflow, the per-bracket-size timing
rules, the automatic dummy-swap behavior, and the conference realignment
detection/override system. Drop that `README.md` inside the zipped
packaged folder too (electron-packager won't include it automatically
since it's not a code dependency - just copy it in next to the .exe
after packaging) so testers have it right there without needing to dig
through Discord history.

## 4. For a more technical successor

If you're handing this off to (or bringing on) someone who wants to dig
into the code itself, not just run the beta - point them at
`TECHNICAL_NOTES.md`. That's the actual save-file reverse-engineering
reference: confirmed byte offsets, table structures, the madden-franchise
library patterns this project depends on, and a list of the open
questions we never fully nailed down. It'll save them from re-discovering
things that took real time to figure out the first time.
