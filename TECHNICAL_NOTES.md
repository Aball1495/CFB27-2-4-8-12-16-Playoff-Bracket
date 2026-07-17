# Technical Notes (for a developer picking this up)

This is the reference doc for anyone who wants to actually modify this
codebase, not just run it. It captures everything that took real,
sometimes multi-hour reverse-engineering effort to figure out - byte
offsets, table structures, encoding schemes, and the dead ends we hit
along the way. If you're extending this tool or building something
similar against CFB27 save files, start here before re-deriving any of
this from scratch.

## What this is

An Electron desktop app that edits EA Sports College Football 27 dynasty
save files directly - builds custom playoff brackets (2/4/8/16-team),
computes an independent BCS-style ranking, and reads/writes real
conference data. It works by manipulating the save file's binary format
directly, both through raw byte offsets (for performance/simplicity on
fields we've fully mapped) and through the `madden-franchise` npm
library's schema-aware API (for anything involving text fields, array-
type references, or exploratory reads where we don't yet know the exact
byte layout).

## Architecture

```
main.cjs          Electron main process. Every ipcMain.handle(...) call is
                  one "feature" - opens the save, does the work, writes a
                  new output file. Never mutates the original.
preload.cjs       Thin bridge exposing main.cjs's IPC handlers to the
                  renderer as window.api.*
index.html        The entire UI - both tools (Conferences, Bracket Tool),
                  all tabs, all client-side logic. One big file
                  deliberately - this is a small enough app that
                  splitting it into a bundler-based multi-file frontend
                  wasn't worth the build-step complexity.
playoffEditorCore.mjs   Low-level save-file primitives: opening/
                  decompressing, reading/writing team refs, bit-level
                  field access, the confirmed byte offset constants.
bcsRankingFull.mjs      The ranking engine - RPI/Colley/Massey/Elo/SOS/
                  WAA computer systems, the simulated human poll, and the
                  weighted combination into a final BCS-style score.
teamConference.mjs      Team-to-conference mapping: hardcoded defaults
                  merged with a user-editable overrides file, reloaded
                  fresh on every read (not cached at module load) so
                  saved changes take effect without restarting the app.
teamLookup.mjs    Team name <-> Team-table row number lookup.
conferenceDetection.mjs   Statistical fallback for conference detection -
                  Louvain-style community detection on the "who played
                  whom" schedule graph. Only used if the exact method
                  (below) fails.
conferenceMemberships.mjs   The exact conference-detection method - reads
                  real membership straight from the save via the
                  Conference table's TeamSlots field (see below).
```

**If you ever add a new file the app needs to write at runtime** (like
`teamConferenceOverrides.json` already is), remember: the packaged .exe
build must use `--asar=false` (already set in `package:win`). Electron
packages default to bundling everything into a single read-only `.asar`
archive - fine for code, fatal for anything the app needs to write back
to disk while running. Without this flag, a runtime write fails with a
misleading `ENOENT` that looks like a missing file, not a permissions/
archive issue. Don't remove that flag without replacing the affected
writes with `app.getPath('userData')`-based paths instead.

## The save file format

A CFB27 dynasty save is a zlib-compressed container. Decompress it (the
zlib stream starts a small, variable number of bytes into the raw file -
`openSave()` in `playoffEditorCore.mjs` scans for the zlib header rather
than assuming a fixed offset) and you get a flat stream of **tables**
laid end to end - this is the same format Madden franchise saves use,
and the community `madden-franchise` library (github.com/bep713/madden-
franchise) already knows how to parse it schema-aware. Tables can appear
multiple times in a file (e.g. eight tables are all named `Team`) - most
are small unused stubs; the real one is reliably the largest by record
capacity. Every table-selection helper in this codebase picks the
largest-capacity instance for exactly this reason.

**References** (how one record points at another) are a standard 32-bit
value: **15 bits table ID + 17 bits row number**, big-endian. All-zero
means null. This is confirmed independently two ways: our own byte-level
reverse engineering, and finding the exact same encoding used by a
sibling community tool (a CFB27 Schedule Generator app) built on the same
`madden-franchise` library. `encodeRef`/`decodeRef` in
`playoffEditorCore.mjs` implement this.

### madden-franchise: two access patterns, and when to use which

This project uses the library two different ways, and it matters which
one you reach for:

1. **Raw byte offsets** (`playoffEditorCore.mjs`) - for fields we've
   fully mapped and validated (bit offset, width, encoding all
   confirmed). Fast, no async overhead, works directly on a `Buffer`.
   Everything under "Confirmed SeasonGame fields" below was found this
   way, through brute-force search against known ground truth (usually a
   real in-game screenshot).

2. **Schema-aware API** (`franchise.getTableById()`, `table.readRecords()`,
   `record.FieldName`) - required for **text fields** (Name, AssetName -
   these live in a separate string-storage section, not a simple bit-
   packed int) and **array-type reference fields** (like `TeamSlots` -
   see the Conference section below). Used in `conferenceMemberships.mjs`
   and in a few places in `main.cjs` directly.

**Critical gotcha discovered the hard way**: when using the schema-aware
API, you must explicitly pin the schema version, or field access can
silently fail (returns garbage/empty instead of throwing):

```js
const franchise = await Franchise.create(savePath, {
  schemaDirectory: path.join(__dirname, 'schemas'),
  autoParse: true,
  schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
});
```

Without `schemaOverride`, the library's auto-detection picked the wrong
bundled schema for at least one real save we tested against, and every
subsequent field read came back empty with no error - not a crash, just
silently wrong. If you ever see a schema-aware read return `0` records
or empty fields on a save that should have real data, check this first.

## Confirmed SeasonGame table fields

The SeasonGame table holds every game in a season - regular season,
conference championships, bowls, and the CFP bracket. **100 bytes per
record.** Locating `recordsStart` for a given save isn't a fixed offset
(it varies per file based on unrelated save state) - the working
technique is: find a byte pattern you know must exist somewhere in the
table (e.g. a specific team-ref pair 28 bytes apart, or a known field
value), search the whole decompressed buffer for it, then derive
`recordsStart` from the match position and the record's known index.
Cross-validate with a second, independent anchor before trusting the
result - a single anchor can coincidentally match elsewhere in a 30MB
file.

| Field | Location | Notes |
|---|---|---|
| HomeTeam ref | byte 8-11 | 32-bit ref, see IMPORTANT below |
| AwayTeam ref | byte 36-39 | 32-bit ref, see IMPORTANT below |
| Stadium ref | byte 0-3 | All-zero = no override, falls back to home team's own stadium. Confirmed by comparing true native CFP slots (always null here) against real neutral-site bowls (always a real ref). **Clearing this on a repurposed bowl slot to try to change hosting was found to cause serious visual corruption in-game (garbled field texture) - do not re-attempt without a much more careful, isolated test than we managed.** |
| SeasonWeek | bit 435, width 5 | **Does not reset between seasons** - keeps climbing across a multi-season dynasty in a 17-value cycle (0-16, then wraps). Season 2's Conference Championship week is raw value 32 (15 + 17), not 15. Always normalize: `normalizeSeasonWeek()` in `playoffEditorCore.mjs` does this (`rawWeek % 17`, with 31 as an unambiguous sentinel checked first). Forgetting this normalization was a real, shipped bug for one full session before we caught it - every hardcoded absolute week check anywhere in this codebase should be using the normalized value. |
| Winner flag | bit 675, width 1 | 0 = home team won, 1 = away team won - but see IMPORTANT below about which team is really "home" |
| BowlGame ref | (part of the ~69-field schema-visible set) | 32-bit ref into a separate bowl-definition table (see below) |
| GameStatus | schema-aware only (enum: seen values include `"Unscheduled"`, `"HomeScheduled"`, `"HomeWon"`) | See IMPORTANT below - a slot can already be marked "finished" before we ever touch it |
| IsSimmed | schema-aware only (bool) | See IMPORTANT below |
| HasBeenPublished | schema-aware only (bool) | Not confirmed to matter, reset alongside the other two out of caution |
| HomeTeamStatus / AwayTeamStatus | schema-aware only (enum) | Always seen as `"Pending"` on every record checked, played or not - doesn't appear to be the relevant flag, left alone |

**IMPORTANT - a bracket slot can already be marked "finished" before we ever
touch it, and we didn't used to reset that.** Confirmed via a real before/
after save comparison from a beta tester: native First Round record 924
showed `GameStatus = "HomeWon"`, `IsSimmed = true` in a save that had
*never* been touched by our tool - the game's own default matchup for that
slot had already been auto-simmed to completion. Our bracket-writing code
only ever wrote the `HomeTeam`/`AwayTeam` references - never these status
fields - so inserting real bracket teams into a slot like this left it
still marked "already decided, nothing left to play" from the game's
perspective, even with brand new teams sitting in it. The schedule screen
reads that as nothing being left to play for that team that week -
displaying as a bye. `run-edit` in `main.cjs` now resets `GameStatus` to
`"HomeScheduled"`, `IsSimmed` to `false`, and `HasBeenPublished` to `false`
on every record it writes teams into, as a second schema-aware pass after
the main byte-level write. **Not yet confirmed in-game that this fully
resolves the bye bug** - the underlying cause is solid (directly observed
in a real before/after diff), but whether `"HomeScheduled"` is precisely
the correct target enum value (as opposed to some other "ready to play"
state we haven't seen an example of) still needs real testing.

**IMPORTANT - the home/away field naming is backwards from what it
implies.** Confirmed via direct user testing: the team written into the
file's **AwayTeam** field is the one that actually displays/hosts as the
true home team in-game. This is the opposite of what the field names
suggest, and it affects every "who's home" calculation project-wide, not
just brackets:

- `writeGame()` in `main.cjs` deliberately swaps which team goes into
  which slot at the point of writing (writes the better/intended-home
  seed into the file's *Away* field, and vice versa) to compensate.
- We do **not** know for certain whether this same inversion holds for
  regular-season games the game simulates itself (as opposed to games we
  write ourselves into bracket/bowl slots specifically). This is
  genuinely unverified - see "Open questions" below. Because of this
  uncertainty, three ranking factors that depended on knowing true home/
  away for real season games (Road Win Bonus, Home Loss Penalty, Elo Home
  Advantage) were removed from the ranking engine entirely rather than
  risk a silently-backwards factor affecting real rankings. If this ever
  gets verified, reintroducing them is straightforward - re-derive from
  `computeGameLogs`'s existing `isHome` flag, which is already computed
  and just currently unused by the scoring formula.

### Fixed bracket/bowl record indices (confirmed, stable across saves)

- **Championship (2-team bracket)**: record **401**
- **Semifinals (4-team bracket uses these; also usable for 2-team's Sugar/Orange NY6, see below)**: records **932, 933**
- **Native First Round / Quarterfinals**: records **924-927** (used directly by 8-team; used as NY6 Peach/Fiesta/Cotton/Rose slots for 2-team/4-team, since those formats don't use them)
- **32 regular bowls**: records **369-400**, in a fixed order (see `REGULAR_BOWLS` in `playoffEditorCore.mjs` for the exact name-to-record mapping)

Records 924-927 display in-game as specific NY6 names when used as NY6
tie-ins: 928=Peach, 929=Fiesta, 930=Cotton, 931=Rose - **confirmed via
real screenshot**, this is not a guess. Records 932-933 (the Semifinal
slots) do **not** carry Sugar/Orange-specific branding - both display
generically as "CFP Semifinal" regardless of what's written there.
Confirmed by reading the actual bowl-definition row they reference (see
next section) - `Name` field literally says "CFP Semifinal" on both.

## The bowl-definition table (branding, not just matchups)

Each SeasonGame record has a `BowlGame` reference field pointing at a
row in a separate table (its exact `tableId` is file-specific - resolve
it dynamically, don't hardcode it) that holds the actual display name,
colors, and logo:

```
Name, AssetName, IsPlayoffBowl, Stadium, Conference1, Conference2,
Trophy, BOWL_PRIMARY_COLOR_{R,G,B}, BOWL_SECONDARY_COLOR_{R,G,B},
BOWL_TERTIARY_COLOR_{R,G,B}, BowlLogoId, PresentationId, GameTime,
DaysOffset, RelativeAppt, PlayoffBracketSlot, Conference1Rank,
Conference2Rank, ...
```

**We attempted to rebrand the 4 repurposed bowls in a 16-team bracket to
show "CFP First Round" (matching the native slots) by editing this row's
`Name`/`AssetName`/`IsPlayoffBowl`/colors/logo. This was confirmed BROKEN
in-game** - even after isolating down to just the `Name`/`AssetName`
text fields alone (removing every other field we'd touched, one at a
time, across several rounds of testing), the field turf still rendered
as a corrupted, garbled texture. We never found the actual root cause -
the working theory is that `IsPlayoffBowl` or some other field we didn't
think to isolate triggers the game to load playoff-specific field art
that fails without matching `PlayoffBracketSlot`/`Trophy`/`Conference1`/
`Conference2` data that a *real* CFP row has and a repurposed bowl's own
row doesn't. **This whole feature was fully reverted and removed from
the shipped app.** If you want to revisit it: don't copy our approach of
editing the bowl's own row directly - the safer angle we didn't get to
try is investigating whether `PlayoffBracketSlot` (and the fields it's
presumably linked to) needs to be populated correctly first, and testing
one single field change at a time with a fresh, never-previously-touched
save for every single test (we lost real time mid-investigation to
accidentally testing against saves that had stale state from earlier,
different code).

Each of the 32 regular bowls also has its own `DaysOffset`/`GameTime`
(real calendar scheduling, confirmed via `RelativeAppt` grouping - bowls
sharing the same `RelativeAppt` value are in the same broader calendar
period, distinguished by `DaysOffset` within it). This is how we
confirmed 2-team brackets need **3 separate Apply passes** if the NY6
feature is ever rebuilt (see below) - 4 of the 6 NY6 bowls play in Week
2, the other 2 in Week 3, and the Championship in Week 4, each requiring
you to be sitting at exactly that moment or the write won't take (same
constraint as the native bracket slots generally).

## The Team table

**788 bytes per record**, 143 real teams. Same "find via known ground
truth, cross-validate" technique as SeasonGame - we located it originally
by brute-forcing candidate `recordsStart` values against several teams'
known real CFP/Media/Coaches ranks read off an actual screenshot, and
required an *exact* match across all of them before trusting the
result.

| Field | Bit offset | Width |
|---|---|---|
| CFP rank | 5555 | 5 |
| Media rank | 5347 | 5 |
| Coaches rank | 5539 | 5 |

These are writable and were previously used to sync in-game poll fields
to bracket seeds - **that feature was removed** (the beta scope was
narrowed down before shipping). The read/write functions
(`getTeamRank`/`writeTeamRank` in `playoffEditorCore.mjs`) are still
there, unused, in case it's worth reviving later.

## Conference table and TeamSlots (the exact-detection mechanism)

The `Conference` table (12 records in every save we've checked) has
`Name` (a real string field) and `TeamSlots` - **not a simple field**,
but a reference to a separate slot-array record. That target record has
one field per slot; each slot is either empty or itself a reference,
specifically to the `Team` table if it's a real member. This exact
pattern - table name, field names, the slot-array indirection - was
found by reading a sibling community tool's bundled code (not guessed),
then independently re-derived and validated against real save data.
`conferenceMemberships.mjs` implements this: `resolveSlotArray()` walks
every field of the referenced slot record and keeps only the ones that
decode as a reference into the Team table.

This exact method is deterministic and correct when it works. It can
fail on some schema versions/saves (falls back automatically to
`conferenceDetection.mjs`'s statistical method - clustering the "who
played whom" schedule graph, since conference-mates play each other far
more often than non-conference opponents). The statistical method is
genuinely just a fallback and can occasionally merge two real
conferences together or misplace independents - always surfaced for
human review before saving, never auto-applied silently.

## Open questions / unfinished investigation

- **The "shows up as a bye" / "wrong opponent shown" bug - full investigation
  history.** This turned out to be at least two distinct symptoms, and the
  second one is still unsolved. Documenting the full trail so this doesn't
  need to be re-derived from scratch.

  **CONFIRMED FIXED**: the original symptom - a bracket slot appearing as
  a bye because the native slot already carried a stale `GameStatus`/
  `IsSimmed` state (e.g. `"HomeWon"`/`true`) from whatever the game's own
  default matchup was, since our tool only ever wrote the team refs and
  never touched these fields. Verified via a real before/after diff from
  a beta tester's save. Fix: `run-edit` in `main.cjs` now runs a second
  schema-aware pass after the main byte write, resetting `GameStatus` to
  `"HomeScheduled"`, `IsSimmed` to `false`, and `HasBeenPublished` to
  `false` on every record it wrote to. Confirmed via diagnostic script
  that this write lands correctly (record 924 went from `"HomeWon"`/
  `true` to `"HomeScheduled"`/`false` as intended).

  **STILL UNSOLVED**: a second, different symptom - certain teams placed
  into the bracket show either the wrong opponent on their Dynasty Hub's
  "Play Game" button (North Dakota State showed "Southern Miss," her
  *original* Famous Idaho Potato Bowl opponent-turned-dummy-swap-target,
  instead of her real new opponent) or no Play Game option at all (Miami
  showed nothing, despite the schedule *list* screen correctly showing
  "Miami vs Kansas State"). This happens even though the underlying
  `SeasonGame` record is 100% correct - confirmed via diagnostic script -
  and even after a full game restart (rules out session caching).

  Theories tested and RULED OUT, each with real evidence:
  - Stale `GameStatus`/`IsSimmed`/`SeasonWeek` on the affected record -
    checked directly, byte-identical to working records.
  - A separate schedule table (`ScheduleKnownGame`, `ScheduleStructureEntry`,
    `ScheduleStructureEntryExact`) holding a stale opponent - searched all
    three for North Dakota State specifically; zero matching entries in
    any of them for the stale opponent.
  - A second, misidentified `SeasonGame` table instance - checked; there's
    one clean large instance (983 capacity) vs the next-largest at 33,
    not ambiguous.
  - Team-table fields (`PlayoffStatus`, `PlayoffRoundReached`) - checked
    for both a working team (Michigan) and a broken one (Miami); **both
    showed identical values** (`"FirstNotClinched"`/`"None"`), so this
    can't be the differentiator even though it's still worth fixing for
    correctness (see below).
  - "Was this team dummy-swapped out of an existing bowl" - directly
    contradicted: TCU was swapped and works fine; Miami wasn't swapped
    and is broken. No clean split by swap history.
  - "Was this team originally projected for a bye" (top-4-seed logic) -
    also contradicted: Oklahoma, SMU, and Texas Tech were *all* originally
    bye teams and all work correctly. Only Miami, the actual #1 overall
    seed specifically, is broken - not "any bye team," just her.

  **MAJOR NEW LEAD, discovered live, not yet investigated with real
  data**: retiring Miami's head coach resolved the issue - her "Play
  Game" button appeared afterward. This potentially reframes the entire
  investigation. Everything explored above (`TeamSeedsTopRank`,
  `PlayoffStatus`, `SeasonGame` fields) assumed the cause lived in
  bracket/schedule data. This result suggests it might instead be a
  completely unrelated mechanic - something like a pending coaching
  decision, contract situation, or job-security state on the `HeadCoach`
  reference that blocks "Play Game" until resolved, independent of the
  bracket at all. This would also cleanly explain why Miami alone was
  affected out of all 16 teams checked: not because she's the #1 overall
  seed specifically, but possibly coincidentally because her coach had
  an unresolved state none of the other coaches did. NEXT STEPS when
  picking this back up: check the `Team.HeadCoach` reference and
  whatever coach-record fields exist around contract/job-security/
  retirement status, comparing Miami's *original* coach (before the
  retirement) against a working team's coach, ideally on a save from
  *before* the retirement was forced (if still available) so the
  comparison is against the actual broken state, not the already-fixed
  one.

  **Current leading lead, untested**: `ScheduleStructure.TeamSeedsTopRank`
  - a `Team[]` array field (paired with `TeamSeedsTopRankValue`, an int
  count) on a singleton table we have never once written to in this
  entire project. Found via the raw JSON schema (not through
  `madden-franchise`'s field listing). Hypothesis: if this array still
  holds whichever team the game's own native logic decided was the #1
  overall seed *before* our bracket edit, and something reads this array
  independently of `SeasonGame` to decide hosting/display behavior for
  the top seed specifically, that would explain why only the actual #1
  seed breaks while other bye-teams don't. `diagnose-topseed-array.mjs`
  checks this directly but is exploratory - untested whether
  `madden-franchise` exposes a `Team[]`-typed field cleanly.

  **A related bug found but NOT the cause of the above**, worth fixing
  regardless: `PlayoffRoundReached` (enum `PlayoffRoundType`) has a real,
  meaningful value `"FirstRound"` we've never written. Every team we
  place into the bracket currently keeps `"None"`. Should be set to the
  correct round reached alongside the `GameStatus` fix, for data
  correctness - confirmed NOT to explain the Miami-specific bug (every
  team, working or broken, shares the same `"None"` value), but still
  incorrect and worth fixing on its own merits.

  Also worth knowing: `PlayoffStatus`'s enum has value-aliasing -
  `"FirstNotClinched"` and `"NotInRunning"` are the literal same stored
  value (`00000`). Whichever name `madden-franchise` reports is arbitrary
  among the aliases; don't read meaning into which specific alias name
  shows up.

  **Untested lead from a live discussion, not yet checked**: Kansas State
  was also dummy-swapped out of the Pop-Tarts Bowl to make room for her in
  the bracket (same as North Dakota State's situation), but we only ever
  checked Miami's side of that specific matchup (925), never Kansas
  State's own Dynasty Hub screen. Worth checking - if she's also broken,
  that's a third data point; if she's fine, Miami's #1-seed-specific
  status becomes an even stronger signal.

- **The schema file itself**: a full JSON-format schema dump (matching
  major=468, minor=2, gameYear=27 - the same version pinned via
  `schemaOverride` everywhere in this project) is a much richer source
  than `madden-franchise`'s own field-name listing - it includes full enum
  definitions with every named value and its underlying stored bit
  pattern, not just whatever name the library happens to report. Worth
  going back to this source directly for any future "what does this
  field actually mean" question, rather than only inferring from observed
  values in saves.

- **Home/away convention for regular-season games** (as opposed to
  bracket/bowl games we write ourselves) - unverified. This is the
  single most valuable thing to nail down if you pick this project back
  up; it would let you safely reintroduce Road Win Bonus, Home Loss
  Penalty, and Elo Home Advantage to the ranking engine. To verify: find
  a real game from an actual dynasty where you're certain which team
  physically hosted (not guessed), and check whether `computeGameLogs`'s
  `isHome` flag (in `bcsRankingFull.mjs`) matches reality for that exact
  game.
- **Bowl rebranding** - confirmed broken, root cause not found. See the
  bowl-definition table section above for what we tried and where we
  stopped.
- **The "Bowls" feature (NY6 tie-ins, other-bowl auto-fill)** - fully
  built at one point (conference-pairing dropdowns, At-Large picks, a
  priority-chain fallback, a 3-stage Apply flow for 2-team's Week 2/3/4
  split) then **deliberately removed** to simplify the beta scope. The
  core safety net (not double-booking a playoff team into a random bowl)
  doesn't depend on it - that's handled independently by the dummy-swap
  logic in `run-edit`, which stays regardless.
- **Sugar/Orange bowl-specific branding** - confirmed there isn't any;
  both display generically as "CFP Semifinal." Not something worth
  re-investigating unless the game gets patched.

## Diagnostic scripts (not shipped in the packaged .exe)

Every `diagnose-*.mjs` file in the project root is a standalone Node
script for investigating save-file structure - run with `node diagnose-
whatever.mjs "<path to save>"` from the project folder (needs
`node_modules` installed, so run from a folder where `npm install` has
already happened, not a bare extracted zip). They're excluded from the
packaged app via `package.json`'s `--ignore` flags - if you write a new
one, remember to add it there too, or it'll ship by accident.

- `diagnose-championship-slot.mjs` - located the 2-team Championship record
- `diagnose-conference-table.mjs` - general-purpose "list tables matching a name filter" tool
- `diagnose-neutral-site.mjs` - found the Stadium field
- `diagnose-bowl-naming.mjs`, `-naming2`, `-naming3` - the bowl-definition table investigation (see above)
- `diagnose-bowl-schedule.mjs` - surveys all 32 regular bowls' real calendar scheduling
- `diagnose-qf-ranks.mjs` - investigating a since-deprioritized cosmetic rank-display issue (the feature it was chasing was removed; may not still be relevant)

## If you want to accelerate future investigation

A community MCP server (`franchise-mcp-server`, wraps the same
`madden-franchise` library) exists that lets an LLM agent directly query
a save file's real schema and data through Claude Code or Claude
Desktop - list tables, read field definitions, search records - instead
of the write-a-script/run-it/paste-output-back loop this whole project
was built through. Every investigation above would have gone faster
with it. Worth setting up before starting any new deep-dive into
save-file structure. It's a separate local tool, not something bundled
with this project - search for it if you want to set it up.
