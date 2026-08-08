# CFB27 Save-Editing Investigation: Session Findings

Written to hand off to another developer working on a similar CFB27
save-editing tool. This covers one extended debugging session investigating
two related-but-distinct display bugs in a custom playoff bracket editor,
plus several genuinely reusable technical discoveries about the save
format itself. Assumes familiarity with `madden-franchise`
(github.com/bep713/madden-franchise) and the general CFB27/Madden save
format (zlib-compressed, table-based, schema-driven).

If you're building something similar, skip straight to **"Reusable
technical findings"** below - that section is useful regardless of what
specific bug you're chasing.

---

## The starting bugs

A custom Electron-based playoff bracket editor (builds 2/4/8/16-team
brackets by writing team references directly into `SeasonGame` records)
had two symptoms after building a 16-team bracket:

1. **Miami (the game's actual #1 overall seed) showed no "Play Game"
   button at all** on her Dynasty Hub, despite the schedule *list* screen
   correctly showing her real matchup.
2. **North Dakota State showed the WRONG opponent** on her Dynasty
   Hub - her original pre-edit opponent (from a bowl she'd been pulled out
   of), not her real new bracket opponent - even though the underlying
   `SeasonGame` record was confirmed correct.

Both symptoms persisted after a full game restart (rules out session
caching) and were confirmed via direct byte/schema-level inspection to
NOT be caused by incorrect data in the obvious places.

## CONFIRMED FIXED: dummy-swap GameStatus bug

**Root cause found in the actual code**, not just inferred:

The tool's write pipeline has two paths that both end up writing team
references into `SeasonGame` records:

1. `writeGame()` - used for real playoff teams going into bracket slots.
   Every record index it touches gets pushed into a `writtenRecords`
   array, which is later used to run a second schema-aware pass resetting
   `GameStatus` to `"HomeScheduled"`, `IsSimmed` to `false`, and
   `HasBeenPublished` to `false` - fixing stale state left over from
   whatever game previously occupied that slot.
2. **The dummy-swap cleanup** (backfills a substitute team into a bowl
   slot vacated by a team who got pulled into the playoff bracket) called
   `writeMatchup()` **directly**, bypassing `writeGame()` entirely. Its
   writes never got added to `writtenRecords`, so they never got the
   `GameStatus` reset.

Result: a bowl slot filled by the dummy-swap logic could be stuck at
`GameStatus = "Unplayed"` (the schema's raw default value) while a slot
filled by the real `writeGame()` path correctly showed
`GameStatus = "HomeScheduled"`. Confirmed via direct diff between a
working swap (a team placed via `writeGame`) and a broken one (a team
placed via the dummy-swap loop) - every field was identical except
exactly this.

**Fix**: in the dummy-swap loop, also push the swapped record's index
into `writtenRecords`. One line. Confirmed via:
- Tool's own log output showing a new reset line for the swapped record
- Direct field diff showing `GameStatus` now matches the working case

**This fix is real, correct, and worth keeping regardless of what else
in this document turns out to be inconclusive.** It did NOT, however,
resolve either of the two display symptoms above - see below.

## CONFIRMED WORKAROUND (mechanism now understood): both display bugs

**Update, later in the same investigation**: this is now a confirmed,
reproducible fix, not just a one-off anecdote. Full procedure and theory
below - this section supersedes earlier framing of these bugs as
"unresolved."

### Unified theory

All observed symptoms in this bug family - Miami's missing "Play Game"
button, North Dakota State's wrong-opponent display, and a third variant
found later (a team's UI showing "on a bye" when they actually had a
real Round 1 matchup) - are almost certainly **the same root cause**:
**the game does not refresh a team's cached schedule/UI state after an
external tool edits `SeasonGame` directly.** Something about a coach
**retirement event** forces that refresh to happen. This tracks with
every clean/dirty result found in this session - every case that looked
"unfixable" was actually just this same missing refresh, and the coach
retirement was never really about the coach at all - it's a trigger for
a broader state recalculation.

### Why it looked broken for custom/user-created coaches

The refresh-via-retirement mechanism itself works the same regardless of
which coach you retire. But retiring a coach that is BOTH
`IsCreated = true` AND `IsUserControlled = true` (i.e., a coach you
created yourself, currently controlling your team) triggers a **separate,
unrelated side effect**: `Team.UserCharacter` (see "Reusable technical
findings" below) gets orphaned, and the team drops out of your
selectable/controllable team list. This made it LOOK like the fix
"didn't work" for custom coaches the first time it was tried in this
session - the display bug genuinely was fixed, but the team became
uncontrollable, which obscured the result and led to chasing a much more
complicated three-variable theory involving an ownership/commissioner
transfer.

**Update, confirmed via later direct testing: the ownership/commissioner
transfer was NOT a red herring after all - it's a genuinely required
step, just for a different reason than originally suspected.** Retiring
your own coach while you are still the Dynasty Owner yourself causes a
separate, still-undiagnosed problem. The fix is procedural, not yet
root-caused: **switch control to a different team and make that team
the Dynasty Owner BEFORE retiring your own coach**, every time. This is
required in addition to (not instead of) the `IsCreated`/
`IsUserControlled` flag fix below - they solve two different problems
that both happen to involve the same retirement action. The earlier
framing in this document (calling the ownership transfer unnecessary)
was wrong and has been corrected here.

**Also confirmed via direct testing:** the retire-and-rehire step needs
repeating for **each round your own team is written into a bracket
slot** - it does not "stick" across multiple Apply operations the way
the `IsCreated`/`IsUserControlled` flags do. For a 16-team bracket
specifically, this means doing the full procedure (ownership switch,
retire, rehire) after BOTH the Round 1 Apply and the Round 2 Apply, if
your team survives that far - not just once. After Round 2, subsequent
rounds (Semifinal, Championship) advance automatically with no further
retirement needed - this asymmetry is believed to be tied to how the
game hard-codes bye handling between these specific rounds, though this
hasn't been independently root-caused either.

### Confirmed fix procedure

**If the coach is a normal AI/default coach** (not created by the user,
not currently the human-controlled team's coach): just retire them in
whatever way triggers a real retirement. No flags need touching, no
ownership switch needed - this only applies to your OWN team. The
game's own native rehire/comeback mechanic handles the rest, and the
display bug clears once the retirement event fires.

**If the coach IS your own, currently-controlled coach** (i.e., the
team you're actually playing as) - follow this exact order:

1. If the coach is user-created, set `IsCreated = False` AND
   `IsUserControlled = False` on them first (ideally done once, early -
   this part is durable and does not need repeating - see below).
2. **Switch control to a different team and make that team the Dynasty
   Owner/Commissioner.** Do this BEFORE the next step - retiring while
   still Dynasty Owner yourself causes a separate, undiagnosed problem.
3. Retire your own coach normally, in-game.
4. Bring them back - either let the game's native rehire mechanic do it,
   or use the `backup-coach.mjs`/`restore-coach.mjs` pair from this
   session if you specifically want the exact same coach back with
   identical stats.
5. Switch control back to your own team.
6. The display bug clears immediately - confirmed via UI showing the
   correct real opponent instead of a stale/wrong one.

**What's durable vs. what needs repeating, confirmed via direct testing:**
- The `IsCreated`/`IsUserControlled` flag fix (step 1) is a one-time,
  durable fix per coach - confirmed still `False` after a full season
  simulation into the next preseason, no regression.
- Steps 2-5 (the actual retire-and-rehire cycle) do NOT stick across
  multiple bracket writes - they need repeating every time your own team
  gets newly written into a bracket slot. For a 16-team bracket, this
  means the full cycle after BOTH the Round 1 Apply and the Round 2
  Apply (if your team survives that far). After Round 2, later rounds
  (Semifinal, Championship) advance on their own with no further
  retirement needed - believed tied to how the game hard-codes bye
  handling between those specific rounds, not independently root-caused.

### Third symptom variant found

A team correctly seeded into a real Round 1 matchup showed the UI
displaying **"on a bye"** instead of their actual opponent (in this
case, showing a bye instead of a real Missouri matchup) - a third
distinct flavor of the same underlying stale-cache family, alongside
"no button at all" and "shows the wrong/old opponent." Same fix applied
cleanly.

### What's still genuinely open

- The exact mechanical reason retirement forces a refresh (something in
  the game's own compiled logic, not save data we can inspect) is still
  unknown - we have a confirmed, reliable trigger, not a root-cause
  explanation.
- Whether some OTHER, cheaper action also forces the same refresh
  (advancing a week, "Force Advance," entering/exiting some specific
  menu) was never tested. If you don't need to preserve a specific
  custom coach at all, it's worth checking whether an even lighter-weight
  action triggers the same fix without touching coaches at all.
- The save-timing theory (edit before vs. after the game's own native
  bowl announcement) was never tested and is now lower priority given
  the coach-retirement workaround is confirmed reliable regardless of
  timing.

---

## Reusable technical findings

Useful regardless of which specific bug you're chasing.

### `team_lookup.json`-style name-to-row maps are NOT universal

If you maintain a `team_name -> row_number` lookup table for resolving
Team-table references, **do not assume that same row-number space
applies to every table that has a `TeamIndex`-shaped field.** We found
`Coach.TeamIndex` (a plain `int` field, range 0-255) uses a **completely
different, denser index space** (0-137, matching the 138 real FBS teams
exactly) than a `Team`-row lookup built from the actual `Team` table
(which had 143 entries in our case, including some `UNKNOWN_PLACEHOLDER`
stub rows). The offset between the two isn't constant - it grows
unevenly across the alphabet (18 off for one team, 22 off for another),
consistent with the `Team` table containing extra stub/placeholder
entries that don't exist in the Coach table's numbering at all.

**Practical fix**: don't try to convert between the two numbering
systems. If you need a coach for a specific team, search the `Coach`
table by `FirstName`/`LastName` string match, or cross-reference via
`Team.HeadCoach` (see below) instead of via `TeamIndex` arithmetic.

### `Team.HeadCoach` vs `Coach.TeamIndex` - two different, both-real links

- `Team.HeadCoach` - type `Coach`, a proper reference (table+row) from a
  Team record to its current coach. This is what actually renders the
  coach on screen.
- `Coach.TeamIndex` - a plain `int` on the Coach's own record, in the
  denser index space described above. Appears to be used for
  Coach-table-internal bookkeeping.

Both exist, both are "real," and they're not interchangeable for lookups
across tables.

### `Team.UserCharacter` - separate from `IsUserControlled` (root cause now identified)

For a team you (the actual human player) control, there are **two
different fields** marking that fact:

- `Coach.IsUserControlled` - a plain bool on the coach's own record.
- `Team.UserCharacter` - type `UserEntity`, a reference field on the TEAM
  record, apparently the actual binding used to determine "which real
  player controls this team."

We found that **retiring your own controlled team's coach clears
`Team.UserCharacter`**, even if you later restore an identical coach
(same stats, same `IsUserControlled = true`) onto whatever row the game
auto-hires as a replacement. The team becomes correctly-coached but
un-selectable as a human-controlled team - it drops out of the team-select
list entirely. Copying the coach's own fields does NOT fix this, because
`UserCharacter` isn't a Coach-table field at all.

**Root cause and fix confirmed** (community-sourced, verified in this
session): the orphaning only happens when the retiring coach has BOTH
`IsCreated = true` AND `IsUserControlled = true` at the moment of
retirement. Setting both to `False` on the coach BEFORE retiring them
avoids the problem entirely - the team stays selectable/controllable
afterward. Verified durable across a full season simulation into the
next preseason. See "Confirmed workaround" section above for the full
procedure - this fix and the coach-retirement display-bug fix are meant
to be used together when the coach you need to retire is your own.

### Coach retirement and the game's own comeback mechanic

The schema includes a full, apparently-functional native "coach comeback"
system: `CoachManager_RetireCoach`, `CoachManager_UnRetireCoach`,
`CoachComebackEvent`, `CoachComebackStartEvent`,
`CoachManager_SendCoachComebackEvent`, and a `ContractStatus` enum value
`PendingRetire` distinct from the terminal `Retired` state. We directly
observed a retired AI coach (not created by the user) show up
re-employed at a different team later in the same dynasty, suggesting
this mechanic does fire on its own over time. **If a coach isn't user-created,
retiring them may not be permanent** - the game's own carousel might
bring them back without any editing. Custom/user-created coaches are the
real risk case (see next section).

### Backing up and restoring a coach's full record (WORKS, tested twice)

Built and validated a two-script workflow to make coach retirement
non-destructive even for a fully custom, user-created coach:

1. **Before retiring**: find the coach by name (see string-padding note
   below), dump every one of the ~136 schema fields to a JSON file via
   the schema-aware API (`record[fieldName]` for each field in
   `table.offsetTable`).
2. **Retire the coach normally in-game.** The game auto-hires some
   replacement.
3. **After the replacement is hired**: find them by name, overwrite
   every field EXCEPT the ones describing their real, current employment
   (`TeamIndex`, `ContractStatus`, `ContractLength`, `ContractSalary`,
   `ContractYearsRemaining`, `SeasonsWithTeam`, job-security fields) with
   the backed-up values, then `franchise.save(outputPath)`.

**Result, confirmed twice on different saves**: 125 of 136 fields wrote
successfully with zero failures each time (the other 11 are the
deliberately-preserved employment fields). Verified the write actually
persisted by re-reading the output file fresh (don't just trust that
`.save()` not throwing means it worked - see next section). The restored
coach was visually and statistically identical in-game: same name, level,
archetype, schemes, alma mater, personality, backstory. Complex
array-type fields (`CareerStats`, `WeeklyGoals`, `ContractYearSummaries`)
transferred without any special handling needed - they read and wrote
fine through the plain schema-aware API, which we hadn't expected going
in.

**Known limitation**: does not touch `Team.UserCharacter` (see above) -
if the coach being retired/restored is the one controlling YOUR team,
you'll get the coach back but may lose the ability to select that team
as human-controlled. Separate, unsolved.

### Fixed-length string fields can have null-byte padding that breaks naive string matching

`Coach.FirstName` (max length 17) and `LastName` (max length 21) are
fixed-width fields. Confirmed via raw byte inspection (searching the
decompressed save directly, independent of `madden-franchise`) that the
actual stored bytes look like `Jack\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00`
- null-byte padding out to the max length, sitting in the schema-aware
API's returned string value too, not just the raw buffer.

**`.trim()` alone does NOT strip this** - null bytes aren't whitespace.
Any exact-match string comparison against a name field needs to also
strip control characters:
```js
function cleanName(s) {
  if (s == null) return '';
  return String(s).replace(/[\x00-\x1F]/g, '').trim();
}
```
This caused a real, confusing "coach not found" failure in this session
before being caught - worth building into any name-lookup helper from
the start rather than discovering it the hard way.

### Schema-aware WRITES work for far more field types than we assumed

Going in, every confirmed *write* operation in the existing tool used raw
byte-offset manipulation (`playoffEditorCore.mjs`'s `writeMatchup` +
`repackSave`) - schema-aware writes via `record[field] = value` +
`franchise.save()` had never been tried for anything beyond exploratory
reads. We tested it directly, on two different tables:

- **Single-field ref write** (`ScheduleStructure.TeamSeedsTopRank`'s
  `Team0` sub-field) - worked, confirmed via re-read.
- **Bulk write across ~125 fields of mixed types** (strings, ints, bools,
  enums, AND complex array-typed fields) on a `Coach` record - worked,
  zero failures, confirmed via re-read.

**Always verify a schema-aware write actually persisted** by reopening
the output file fresh and re-reading the field(s) you changed. A
`.save()` call not throwing is necessary but not sufficient evidence
that the write landed - we treated this as an open question each time
and checked explicitly rather than assuming.

### `recordsStart` / table-instance-selection gotchas (carried over from earlier work, still holds)

- Tables can appear multiple times in a save under the same name (e.g.
  many stub/unused `Team` or `SeasonGame` instances alongside the one
  real one). Always pick the largest-`recordCapacity` instance.
- `schemaOverride` must be pinned explicitly
  (`{ major, minor, gameYear, path }`) when creating a `Franchise`
  instance - auto-detection can silently pick the wrong bundled schema
  version, resulting in reads that return `0`/empty with no error at all,
  not a crash.

---

## Scripts included in this handoff

All are standalone Node scripts (ESM, `.mjs`), built against
`madden-franchise`, requiring the same `schemas/` directory
(schema-pinned to `major: 468, minor: 2, gameYear: 27`) and
`teamLookup.mjs`-style name resolution as the parent project. Run each
with no arguments to see usage.

| Script | Purpose |
|---|---|
| `find-team-record.mjs` | Search the entire `SeasonGame` table by team name; prints every record number that team appears in, with opponent/week/status. Use this instead of guessing which fixed bracket index a team landed in. |
| `diagnose-fulldiff.mjs` | Diff ALL schema-visible fields of two `SeasonGame` records side by side, flagging differences first. |
| `diagnose-bowldef-diff.mjs` | Follows each of two `SeasonGame` records' `BowlGame` reference and diffs the bowl-DEFINITION rows they point to (`Name`, `IsPlayoffBowl`, `PlayoffBracketSlot`, `Trophy`, `Conference1/2`, colors, etc.) - a different table than `SeasonGame` itself. |
| `diagnose-topseed-array-fixed.mjs` | Correctly reads `ScheduleStructure.TeamSeedsTopRank` (a `Team[]` array field) by following its reference to the actual backing record(s), reading however many rows `TeamSeedsTopRankValue` requires. |
| `write-topseed.mjs` | Writes a new team into `TeamSeedsTopRank`'s first slot. Empirical test tool - confirmed the write mechanism works, though the underlying theory it was testing turned out to be wrong. |
| `backup-coach.mjs` / `restore-coach.mjs` | The coach backup/restore pair described above. Null-byte-safe name matching, near-match diagnostics if an exact match fails. |
| `read-team-field.mjs` / `write-team-field.mjs` | Generic single-field read/write on any `Team` record by team name. Built for the `UserCharacter` investigation but works for any field. |

## Suggested priority order if continuing this investigation

1. **Test lighter-weight triggers** - does advancing a week, "Force
   Advance," or entering/exiting some specific menu also force the same
   schedule/UI refresh, without needing to touch a coach at all? Would
   simplify the fix further for cases where you don't care about coach
   identity.
2. **Understand the actual mechanism** - the confirmed workaround (coach
   retirement forces a refresh) works reliably, but *why* is still
   unknown - this lives in the game's own compiled logic, not anything
   inspectable in the save file.
3. **The save-timing theory** (editing before vs. after the game's own
   native bowl announcement) is now lower priority given the retirement
   workaround is confirmed reliable regardless of when the edit happens.
