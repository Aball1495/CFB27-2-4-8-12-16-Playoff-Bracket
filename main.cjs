// main.cjs - Electron main process.
// Note: uses .cjs extension so it runs as CommonJS even though the rest of
// the project is ESM ("type": "module" in package.json). Dynamic import()
// is used to pull in the ESM core logic - this works fine from CommonJS.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

let mainWindow;

// --- 16-team CFP First Round presentation conversion ---
// Confirmed working end-to-end via live in-game testing tonight
// (stadium, playoff status/field markings/announcer commentary, logo,
// jersey patch all verified correct across multiple teams). Ported
// here from the standalone test scripts that proved each piece.
//
// The 4 repurposed bowls, their BowlGame table row, and their ORIGINAL
// presentation values - needed both to know what to write for the
// "convert" direction (native CFP rows 7-10 supply those), and to
// revert back to exactly this on the "revert" direction. Captured
// directly from a real, unmodified save via check-bowl-logo.mjs and
// check-bowlgame-reference.mjs - not guessed.
const CFP_REPURPOSED_BOWLS = [
  {
    name: 'Boca Raton Bowl', row: 5, nativeRow: 7, slot: 4,
    original: { Name: 'Boca Raton Bowl', AssetName: 'Boca_Raton_Bowl', BowlLogoId: 21,
      BOWL_PRIMARY_COLOR_R: 210, BOWL_PRIMARY_COLOR_G: 20, BOWL_PRIMARY_COLOR_B: 55,
      BOWL_SECONDARY_COLOR_R: 191, BOWL_SECONDARY_COLOR_G: 6, BOWL_SECONDARY_COLOR_B: 49,
      BOWL_TERTIARY_COLOR_R: 243, BOWL_TERTIARY_COLOR_G: 195, BOWL_TERTIARY_COLOR_B: 0,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 },
  },
  {
    name: 'Cure Bowl', row: 18, nativeRow: 8, slot: 5,
    original: { Name: 'Cure Bowl', AssetName: 'Cure_Bowl', BowlLogoId: 23,
      BOWL_PRIMARY_COLOR_R: 233, BOWL_PRIMARY_COLOR_G: 128, BOWL_PRIMARY_COLOR_B: 168,
      BOWL_SECONDARY_COLOR_R: 18, BOWL_SECONDARY_COLOR_G: 25, BOWL_SECONDARY_COLOR_B: 33,
      BOWL_TERTIARY_COLOR_R: 255, BOWL_TERTIARY_COLOR_G: 255, BOWL_TERTIARY_COLOR_B: 255,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 },
  },
  {
    name: 'Gasparilla Bowl', row: 25, nativeRow: 9, slot: 6,
    original: { Name: 'Gasparilla Bowl', AssetName: 'Gasparilla_Bowl', BowlLogoId: 28,
      BOWL_PRIMARY_COLOR_R: 0, BOWL_PRIMARY_COLOR_G: 97, BOWL_PRIMARY_COLOR_B: 104,
      BOWL_SECONDARY_COLOR_R: 243, BOWL_SECONDARY_COLOR_G: 108, BOWL_SECONDARY_COLOR_B: 35,
      BOWL_TERTIARY_COLOR_R: 99, BOWL_TERTIARY_COLOR_G: 101, BOWL_TERTIARY_COLOR_B: 106,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 },
  },
  {
    name: 'New Orleans Bowl', row: 37, nativeRow: 10, slot: 7,
    original: { Name: 'New Orleans Bowl', AssetName: 'New_Orleans_Bowl', BowlLogoId: 39,
      BOWL_PRIMARY_COLOR_R: 60, BOWL_PRIMARY_COLOR_G: 25, BOWL_PRIMARY_COLOR_B: 82,
      BOWL_SECONDARY_COLOR_R: 60, BOWL_SECONDARY_COLOR_G: 174, BOWL_SECONDARY_COLOR_B: 73,
      BOWL_TERTIARY_COLOR_R: 0, BOWL_TERTIARY_COLOR_G: 102, BOWL_TERTIARY_COLOR_B: 73,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 },
  },
];
const CFP_PRESENTATION_FIELDS = ['AssetName', 'BowlLogoId', 'BOWL_PRIMARY_COLOR_R', 'BOWL_PRIMARY_COLOR_G',
  'BOWL_PRIMARY_COLOR_B', 'BOWL_SECONDARY_COLOR_R', 'BOWL_SECONDARY_COLOR_G', 'BOWL_SECONDARY_COLOR_B',
  'BOWL_TERTIARY_COLOR_R', 'BOWL_TERTIARY_COLOR_G', 'BOWL_TERTIARY_COLOR_B'];
const BOWL_GAME_UNIQUE_ID = 902037496;
const CFP_PREFERENCE_PATH = path.join(__dirname, 'cfpConversionPreference.json');

function readCfpConversionPreference() {
  try {
    return JSON.parse(fs.readFileSync(CFP_PREFERENCE_PATH, 'utf8'));
  } catch {
    return { skipPrompt: false };
  }
}
function writeCfpConversionPreference(pref) {
  fs.writeFileSync(CFP_PREFERENCE_PATH, JSON.stringify(pref));
}

// Stadium fix: raw 4-byte copy from the host team's own permanent
// Team.Stadium field into the SeasonGame record - reference-type
// fields can't be reliably read/written through the schema API (see
// SESSION_FINDINGS.md - Stadium is a polymorphic/Enum reference type
// this version of madden-franchise can't resolve), but a raw byte copy
// sidesteps that entirely, proven directly in-game.
// Generic version of the same proven technique: copy a team's own
// permanent Stadium field into an arbitrary SeasonGame record's
// Stadium field via raw byte copy (reference-type fields can't be
// read/written reliably through the schema API - see
// SESSION_FINDINGS.md). Returns true/false so callers can log
// specifically what happened.
// Corrects every player's most recent SeasonStats entry to match their
// CURRENT roster team (Player.TeamIndex), treating roster as ground
// truth - same principle already confirmed safe and working by the
// separate Stats Tool's repair script. Runs automatically on every
// Apply, so this never has to be run as a separate manual step.
//
// IMPORTANT CAVEAT: this treats the SYMPTOM, not a confirmed root
// cause. Whether this tool's own writeMatchup()/repackSave() path
// actually causes the underlying corruption, or whether it's a native/
// pre-existing issue unrelated to this tool, is still an open,
// untested question (see check-seasonstats-consistency.mjs for the
// before/after test that would settle it). This correction is safe and
// worth running regardless of that answer, but if it turns out our own
// write path is the actual cause, the deeper fix would need to happen
// in writeMatchup() itself, not just here.
async function correctSeasonStatsToMatchRoster(outputPath, schemaDirectory, log) {
  const Franchise = (await import('madden-franchise')).default;
  const { TABLE_UNIQUE_IDS } = await import('./playoffEditorCore.mjs');
  const franchise = await Franchise.create(outputPath, {
    schemaDirectory,
    schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
  });

  const teamMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.Team);
  const teamTable = teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await teamTable.readRecords();
  const teamIndexToRow = new Map();
  for (let i = 0; i < teamTable.records.length; i++) {
    const rec = teamTable.records[i];
    if (!rec) continue;
    let idx;
    try { idx = rec['TeamIndex']; } catch { continue; }
    if (idx !== undefined) teamIndexToRow.set(idx, i);
  }

  // Cache field key -> index per _fieldsArray prototype to avoid repeated
  // linear searches. With 16,500 players × 18 slot scans, the original
  // linear find() was doing ~300k array traversals per Apply run.
  const fieldIndexCache = new WeakMap();
  function getFieldObj(rec, key) {
    if (!rec._fieldsArray) return undefined;
    let cache = fieldIndexCache.get(rec._fieldsArray);
    if (!cache) {
      cache = new Map();
      for (let fi = 0; fi < rec._fieldsArray.length; fi++) {
        cache.set(rec._fieldsArray[fi]._key, fi);
      }
      fieldIndexCache.set(rec._fieldsArray, cache);
    }
    const idx = cache.get(key);
    return idx !== undefined ? rec._fieldsArray[idx] : undefined;
  }

  const playerTable = franchise.tables.find(t => t.header.name === 'Player');
  await playerTable.readRecords();
  const containerTable = franchise.tables.find(t => t.header.name === 'SeasonStats[]');
  await containerTable.readRecords();
  const tableById = new Map();
  for (const t of franchise.tables) tableById.set(t.header.tableId, t);
  const readTables = new Set();

  // --- Pass 1: resolve every player's "last populated slot" reference,
  // and count how many DIFFERENT players resolve to the exact same
  // (tableId, rowNumber). A real season-stat leaf record belongs to
  // exactly one player - if more than one player points at the same
  // one, that's proof it's a shared default/template reference (e.g.
  // inactive/practice-squad players who were never assigned their own
  // real SeasonStats history), not genuine data. Confirmed via real
  // save diagnostics: many unrelated players (different current teams,
  // different rows) all resolved to the identical leaf address. Writing
  // to a shared reference means whichever player gets processed last
  // silently overwrites every other player's (and possibly a real
  // player's) actual stat record - so these must never be corrected.
  const candidates = []; // { playerRow, currentTeamIndex, leafTableId, leafRowNumber }
  const refCounts = new Map(); // "tableId:rowNumber" -> count of distinct players

  for (let i = 0; i < playerTable.records.length; i++) {
    const rec = playerTable.records[i];
    if (!rec) continue;
    let currentTeamIndex;
    try { currentTeamIndex = rec['TeamIndex']; } catch { continue; }
    if (currentTeamIndex === undefined || currentTeamIndex === null) continue;

    const seasonStatsField = getFieldObj(rec, 'SeasonStats');
    const containerRef = seasonStatsField?.referenceData;
    if (!containerRef || containerRef.rowNumber === undefined) continue;
    const containerRec = containerTable.records[containerRef.rowNumber];
    if (!containerRec) continue;

    let lastPopulatedSlotRef = null;
    for (let slot = 0; slot < 18; slot++) {
      const slotField = getFieldObj(containerRec, `SeasonStats${slot}`);
      const ref = slotField?.referenceData;
      if (ref && (ref.tableId !== 0 || ref.rowNumber !== 0)) lastPopulatedSlotRef = ref;
    }
    if (!lastPopulatedSlotRef) continue;

    const key = `${lastPopulatedSlotRef.tableId}:${lastPopulatedSlotRef.rowNumber}`;
    refCounts.set(key, (refCounts.get(key) || 0) + 1);
    candidates.push({ playerRow: i, currentTeamIndex, leafTableId: lastPopulatedSlotRef.tableId, leafRowNumber: lastPopulatedSlotRef.rowNumber, key });
  }

  // --- Pass 2: only correct players whose leaf reference is uniquely
  // theirs (refCounts === 1). Shared references are skipped entirely -
  // never written to, and not counted toward checkedCount, since they
  // were never a legitimate per-player record to check in the first
  // place.
  let correctedCount = 0, checkedCount = 0, skippedSharedCount = 0;

  for (const c of candidates) {
    if (refCounts.get(c.key) > 1) { skippedSharedCount++; continue; }

    const leafTable = tableById.get(c.leafTableId);
    if (!leafTable) continue;
    if (!readTables.has(leafTable)) { await leafTable.readRecords(); readTables.add(leafTable); }
    const leafRec = leafTable.records[c.leafRowNumber];
    if (!leafRec) continue;

    let statTeamIndex;
    try { statTeamIndex = leafRec['YEARBYYEARTEAMINDEX']; } catch { continue; }
    checkedCount++;

    if (statTeamIndex !== c.currentTeamIndex) {
      const correctRow = teamIndexToRow.get(c.currentTeamIndex);
      let correctName = null;
      if (correctRow !== undefined) {
        // Read the real in-game field directly off the Team record
        // rather than going through the static rowToName lookup.
        // rowToName pulls from team_lookup.json, which (a) may not
        // match TEAM_PREFIX_NAME's actual format, and (b) has no
        // protection against placeholder rows (UNKNOWN_PLACEHOLDER_30-34)
        // - both would silently write a wrong/garbage string into a
        // real save. This mirrors the fix apply_stat_repair.cjs already
        // uses, and avoids the same "Jax State" vs "Jacksonville State"
        // guesswork bug this project hit once before.
        try { correctName = teamTable.records[correctRow]['TEAM_PREFIX_NAME']; } catch { correctName = null; }
      }
      try {
        leafRec['YEARBYYEARTEAMINDEX'] = c.currentTeamIndex;
        if (correctName) leafRec['TeamPrefixName'] = correctName;
        correctedCount++;
      } catch (err) {
        log.push(`  WARNING - could not correct season-stat team for player record ${c.playerRow}: ${err.message}`);
      }
    }
  }

  if (correctedCount > 0) {
    await franchise.save(outputPath);
    log.push(`Season-stat team correction: fixed ${correctedCount} of ${checkedCount} checked player records (roster treated as ground truth). Skipped ${skippedSharedCount} record(s) pointing at a shared/template reference (not real per-player data - left untouched).`);
  } else {
    log.push(`Season-stat team correction: checked ${checkedCount} player records, no corrections needed. Skipped ${skippedSharedCount} record(s) pointing at a shared/template reference (not real per-player data - left untouched).`);
  }
}

async function copyTeamStadiumIntoGame(franchise, teamTable, buf, recordsStart, recordSize, seasonRecordIndex, teamName, log, contextLabel) {
  const { rowToName } = await import('./teamLookup.mjs');
  function getFieldObj(rec, key) { return (rec._fieldsArray || []).find(f => f._key === key); }
  function findTeamRow(name) {
    for (let i = 0; i < teamTable.records.length; i++) {
      let n;
      try { n = rowToName(i); } catch { continue; }
      if (n === name) return i;
    }
    return null;
  }

  const teamRow = findTeamRow(teamName);
  if (teamRow === null) { log.push(`  ${contextLabel}: could not find ${teamName} in Team table - stadium not changed.`); return false; }
  const teamRec = teamTable.records[teamRow];
  const stadiumField = getFieldObj(teamRec, 'Stadium');
  if (!stadiumField || !stadiumField.value || /^0+$/.test(stadiumField.value)) { log.push(`  ${contextLabel}: ${teamName}'s own Stadium field is empty - stadium not changed.`); return false; }
  const stadiumOffsetInfo = teamRec._offsetTable?.find(f => f.name === 'Stadium');
  if (!stadiumOffsetInfo) { log.push(`  ${contextLabel}: could not resolve Stadium's byte offset - stadium not changed.`); return false; }
  const byteOffset = stadiumOffsetInfo.offset / 8;

  const teamTableOffset = teamTable.offset + teamTable.header.headerSize;
  const teamRecordSize = teamTable.header.record1Size;
  const sourceOffset = teamTableOffset + teamRow * teamRecordSize + byteOffset;
  const targetOffset = recordsStart + seasonRecordIndex * recordSize + 4; // confirmed: Stadium is byte 4, 4 bytes, on SeasonGame
  buf.copy(buf, targetOffset, sourceOffset, sourceOffset + 4);
  log.push(`  ${contextLabel}: now uses ${teamName}'s real home stadium.`);
  return true;
}

// Standalone, reusable rank-sync - shared by the bracket-building flow
// (seedAssignments = the bracket's actual seeds, 1 through bracketSize)
// and the new standalone BCS Rankings app (seedAssignments = [], so
// ranks 1-25 come straight from rankingOrder with no bracket carve-out
// at all). Same explicit-NR-for-everyone-else logic either way - that's
// what actually eliminates rank collisions, not just working around them.
async function syncPollRanks(teamTable2, seedAssignments, rankingOrder, teamRow, rowToName, log) {
  const POLLS = ['CFPPoll', 'CoachesPoll', 'MediaPoll'];
  const rankedRows = new Set();

  for (const { row, seed: s } of seedAssignments) {
    const rec = teamTable2.records[row];
    if (!rec) { log.push(`Rank sync - row ${row}: no record found, skipped.`); continue; }
    const before = rec['CFPPoll_CurrentRank'];
    for (const poll of POLLS) {
      rec[`${poll}_LastWeeksRank`] = rec[`${poll}_CurrentRank`];
      rec[`${poll}_CurrentRank`] = s;
    }
    rec['TeamRank'] = s;
    rankedRows.add(row);
    log.push(`Rank sync - ${rowToName(row)}: rank -> ${s} (was ${before}).`);
  }

  if (rankingOrder && rankingOrder.length) {
    let nextRank = seedAssignments.length + 1;
    for (const teamName of rankingOrder) {
      if (nextRank > 25) break;
      const row = teamRow(teamName);
      if (row === null || row === undefined || rankedRows.has(row)) continue;
      const rec = teamTable2.records[row];
      if (!rec) continue;
      for (const poll of POLLS) {
        rec[`${poll}_LastWeeksRank`] = rec[`${poll}_CurrentRank`];
        rec[`${poll}_CurrentRank`] = nextRank;
      }
      rec['TeamRank'] = nextRank;
      rankedRows.add(row);
      log.push(`Rank sync - ${teamName}: rank -> ${nextRank}${seedAssignments.length ? ' (next-best outside the bracket)' : ''}.`);
      nextRank++;
    }
  }

  let clearedCount = 0;
  const UNRANKED_SENTINEL = 255; // confirmed via real in-game screenshot: 0 sorts to the TOP (treated as "best"), not bottom - it's just the schema's default/uninitialized value, not a real NR signal. 255 (the field's actual max) sorts last instead.
  for (let row = 0; row < teamTable2.records.length; row++) {
    if (rankedRows.has(row)) continue;
    let name;
    try { name = rowToName(row); } catch { continue; }
    if (!name) continue; // not a real team row
    const rec = teamTable2.records[row];
    let alreadySentinel = true;
    try { alreadySentinel = rec['CFPPoll_CurrentRank'] === UNRANKED_SENTINEL && rec['TeamRank'] === UNRANKED_SENTINEL; } catch { alreadySentinel = false; }
    if (alreadySentinel) continue;
    for (const poll of POLLS) {
      rec[`${poll}_LastWeeksRank`] = rec[`${poll}_CurrentRank`];
      rec[`${poll}_CurrentRank`] = UNRANKED_SENTINEL;
    }
    rec['TeamRank'] = UNRANKED_SENTINEL;
    clearedCount++;
  }
  if (clearedCount > 0) log.push(`Rank sync - pushed ${clearedCount} other team(s) to the bottom (unranked), eliminating stale native ranks that could collide with the numbers above.`);
}

async function applyStadiumFix(outputPath, schemaDirectory, log) {
  const { openSave, repackSave, REGULAR_BOWLS, TABLE_UNIQUE_IDS } = await import('./playoffEditorCore.mjs');
  const Franchise = (await import('madden-franchise')).default;
  const { rowToName } = await import('./teamLookup.mjs');

  const franchise = await Franchise.create(outputPath, {
    schemaDirectory,
    schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
  });
  const seasonMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.SeasonGame);
  const seasonTable = seasonMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await seasonTable.readRecords();
  const teamMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.Team);
  const teamTable = teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await teamTable.readRecords();

  function getFieldObj(rec, key) { return (rec._fieldsArray || []).find(f => f._key === key); }
  function teamNameOf(rec, key) {
    const f = getFieldObj(rec, key);
    const ref = f?.referenceData;
    return ref ? rowToName(ref.rowNumber) : null;
  }

  const { unpackedFileContents, recordsStart, recordSize } = await openSave(outputPath, schemaDirectory);
  const buf = Buffer.from(unpackedFileContents);

  let fixedCount = 0;
  for (const bowl of CFP_REPURPOSED_BOWLS) {
    const bowlInfo = REGULAR_BOWLS.find(b => b.name === bowl.name);
    const seasonRecordIndex = bowlInfo?.record;
    if (seasonRecordIndex === undefined) { log.push(`  CFP presentation: could not resolve ${bowl.name}'s SeasonGame record - stadium not changed.`); continue; }
    const rec = seasonTable.records[seasonRecordIndex];
    if (!rec) continue;
    // Confirmed empirically against a real applied save: HomeTeam (not
    // the swap-aware AwayTeam) is the correct host field for these
    // specific repurposed-bowl records - see SESSION_FINDINGS.md.
    const hostTeam = teamNameOf(rec, 'HomeTeam');
    if (!hostTeam) { log.push(`  CFP presentation: could not determine host team for ${bowl.name} - stadium not changed.`); continue; }
    const ok = await copyTeamStadiumIntoGame(franchise, teamTable, buf, recordsStart, recordSize, seasonRecordIndex, hostTeam, log, `  CFP presentation (${bowl.name})`);
    if (ok) fixedCount++;
  }

  if (fixedCount > 0) {
    const originalRawBuf = await fsPromises.readFile(outputPath);
    const finalBuf = repackSave(originalRawBuf, buf);
    await fsPromises.writeFile(outputPath, finalBuf);
  }
}

// Fixed neutral-site "premier stadium" picker for the Championship
// location (record 401, confirmed across every bracket size) and, for
// 2-team/4-team formats, for leftover NY6 slots too. Each raw word is
// a direct 32-bit Stadium-field reference into the game's own internal
// asset catalog (NOT a row in any enumerable save-file table -
// confirmed via extensive testing this session: decoding these values
// never resolves to a real franchise.tables entry, meaning they're
// baked into the game engine itself). Because of that, these values
// are NOT save-specific - they should be valid across any save file,
// not just the one they were captured from.
//
// Sourced two ways, both confirmed against real, direct in-game visual
// checks (not inferred from bracket-screen labels, which were proven
// UNRELIABLE for the native CFP quarterfinal/semifinal slots - same
// raw word got a different real bowl name attached in different
// seasons for those specific slots):
//   1. PlayoffBowlsInfo table (tableId 4125, 6 fixed records, one per
//      real NY6 bowl by NAME - immune to bracket-slot rotation by
//      design) - the 6 NY6 sites below.
//   2. A regular bowl's or conference championship's OWN Stadium field
//      (offset +4) - both confirmed stable/consistent across multiple
//      real seasons of testing, unlike the native CFP slots. Several
//      of these were independently cross-validated more than once:
//      Citrus/Pop-Tarts Bowl share an identical raw word (both are
//      genuinely Camping World Stadium in real life), as do Gasparilla/
//      Reliaquest (both Raymond James); Lucas Oil and Mercedes-Benz
//      each matched exactly across two different real seasons.
const PREMIER_STADIUMS = {
  // --- NY6 bowls, from PlayoffBowlsInfo (tableId 4125) ---
  'AT&T Stadium': 2154005968,          // Cotton Bowl (the game)
  'Caesars Superdome': 2154005967,     // Sugar Bowl
  'Hard Rock Stadium': 2154006023,     // Orange Bowl
  'Mercedes-Benz Stadium': 2154006071, // Peach Bowl
  'Rose Bowl': 2154122462,
  'State Farm Stadium': 2154012135,    // Fiesta Bowl

  // --- Confirmed via this dynasty's own conference championships ---
  'MetLife Stadium': 2154122425,          // American Championship
  'M&T Bank Stadium': 2154017734,         // ACC Championship
  'Lincoln Financial Field': 2154122408,  // MAC Championship (current)
  'Cotton Bowl': 2154005953,              // Sun Belt Championship - the ACTUAL historic stadium, distinct from AT&T Stadium above
  'SoFi Stadium': 2154012133,             // Pac-12 Championship
  'Lucas Oil Stadium': 2154122413,        // Big Ten Championship
  'Ford Field': 2154122369,               // MAC Championship (season 1, before reassignment)

  // --- Confirmed via regular bowl records ---
  'Allegiant Stadium': 2154122467,       // Las Vegas Bowl
  'Bank of America Stadium': 2154005939, // Duke's Mayo Bowl (also matches season-1 ACC Championship exactly)
  'Camping World Stadium': 2154448661,   // Citrus Bowl / Pop-Tarts Bowl (identical raw word confirmed both ways)
  'Nissan Stadium': 2154012096,          // Music City Bowl
  'NRG Stadium': 2154012110,             // Texas Bowl
  'Raymond James Stadium': 2154122451,   // Gasparilla Bowl / Reliaquest Bowl (identical raw word confirmed both ways)
  'Everbank Stadium': 2154012161,        // Gator Bowl
};

// For 2-team and 4-team bracket formats, the actual games that play
// as the real NY6 bowls are the week-18 regular bowl SeasonGame records
// whose BowlGame rows get repurposed - matching NY6_REPURPOSED_BOWLS.
// These are the records the user sets teams on, and where the venue
// and branding get written.

// Exact Name values from PlayoffBowlsInfo (tableId 4125) - the real,
// stable, per-bowl table discovered this session. Only these 6 names
// are valid choices for assignRealBowlToLeftoverSlot.
const REAL_NY6_BOWL_NAMES = ['Rose Bowl', 'Sugar Bowl', 'Orange Bowl', 'Cotton Bowl', 'Fiesta Bowl', 'Peach Bowl'];

// Plain scalar BowlGame fields safe to copy via ordinary schema-API
// assignment - same confirmed-safe list as CFP_PRESENTATION_FIELDS,
// plus Name (also already proven safe elsewhere in this file).
// Deliberately excludes Stadium and Trophy - both are reference-type
// fields (same raw bit-string representation problem Stadium had
// everywhere else this session), not plain scalars, so they need the
// raw-buffer treatment instead of rec[field]=value.
const NY6_BRANDING_FIELDS = ['Name', 'AssetName', 'BowlLogoId', 'PresentationId',
  'BOWL_PRIMARY_COLOR_R', 'BOWL_PRIMARY_COLOR_G', 'BOWL_PRIMARY_COLOR_B',
  'BOWL_SECONDARY_COLOR_R', 'BOWL_SECONDARY_COLOR_G', 'BOWL_SECONDARY_COLOR_B',
  'BOWL_TERTIARY_COLOR_R', 'BOWL_TERTIARY_COLOR_G', 'BOWL_TERTIARY_COLOR_B'];

/**
 * Assigns real NY6 bowl identities (location AND branding) to a batch
 * of leftover native slots that aren't real bracket games this season.
 * assignments is an array of { record, bowlName }.
 *
 * Follows the same proven two-phase sequencing already used by
 * applyCfpConversion (applyStadiumFix then writeBowlGamePresentation) -
 * raw-buffer writes and schema-API writes are NOT mixed on one shared
 * franchise instance; phase 2 re-opens fresh from whatever phase 1 just
 * wrote to outputPath. Safe to re-run repeatedly - each run just
 * overwrites the same fields with the same values, which matters since
 * the game may regenerate some of these fields as the season
 * progresses through week 2/3, so this may need re-applying closer to
 * when each game is actually played.
 */
// Week-18 regular bowl rows that get repurposed as real NY6 bowls for
// 2-team and 4-team bracket formats. Exactly mirrors CFP_REPURPOSED_BOWLS
// but for the NY6 (quarterfinal/semifinal) slots instead of the First
// Round slots. Original values captured from DYNASTY-PLAYOFFTEST for
// the revert path - same pattern as CFP_REPURPOSED_BOWLS.
//
// Slot assignment (matches NY6_LEFTOVER_SLOTS_BY_SIZE):
//   4-team: slots 928-931 use the first 4 entries (rows 6, 19, 23, 26)
//   2-team: slots 928-933 use all 6 entries (rows 6, 19, 23, 26, 40, 42)
const NY6_REPURPOSED_BOWLS = [
  { seasonGame: 399, row: 6,
    original: { Name: 'Citrus Bowl', AssetName: 'Citrus_Bowl', BowlLogoId: 10, PresentationId: 35,
      BOWL_PRIMARY_COLOR_R: 206, BOWL_PRIMARY_COLOR_G: 14, BOWL_PRIMARY_COLOR_B: 45,
      BOWL_SECONDARY_COLOR_R: 255, BOWL_SECONDARY_COLOR_G: 81, BOWL_SECONDARY_COLOR_B: 0,
      BOWL_TERTIARY_COLOR_R: 245, BOWL_TERTIARY_COLOR_G: 168, BOWL_TERTIARY_COLOR_B: 0,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 } },
  { seasonGame: 392, row: 19,
    original: { Name: "Duke's Mayo Bowl", AssetName: 'Duke_s_Mayo_Bowl', BowlLogoId: 3, PresentationId: 28,
      BOWL_PRIMARY_COLOR_R: 255, BOWL_PRIMARY_COLOR_G: 198, BOWL_PRIMARY_COLOR_B: 41,
      BOWL_SECONDARY_COLOR_R: 234, BOWL_SECONDARY_COLOR_G: 29, BOWL_SECONDARY_COLOR_B: 37,
      BOWL_TERTIARY_COLOR_R: 18, BOWL_TERTIARY_COLOR_G: 25, BOWL_TERTIARY_COLOR_B: 33,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 } },
  { seasonGame: 385, row: 23,
    original: { Name: 'First Responder Bowl', AssetName: 'First_Responder_Bowl', BowlLogoId: 26, PresentationId: 20,
      BOWL_PRIMARY_COLOR_R: 244, BOWL_PRIMARY_COLOR_G: 123, BOWL_PRIMARY_COLOR_B: 61,
      BOWL_SECONDARY_COLOR_R: 28, BOWL_SECONDARY_COLOR_G: 77, BOWL_SECONDARY_COLOR_B: 161,
      BOWL_TERTIARY_COLOR_R: 213, BOWL_TERTIARY_COLOR_G: 28, BOWL_TERTIARY_COLOR_B: 41,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 } },
  { seasonGame: 395, row: 26,
    original: { Name: 'Gator Bowl', AssetName: 'Gator_Bowl', BowlLogoId: 6, PresentationId: 31,
      BOWL_PRIMARY_COLOR_R: 207, BOWL_PRIMARY_COLOR_G: 51, BOWL_PRIMARY_COLOR_B: 56,
      BOWL_SECONDARY_COLOR_R: 127, BOWL_SECONDARY_COLOR_G: 39, BOWL_SECONDARY_COLOR_B: 41,
      BOWL_TERTIARY_COLOR_R: 84, BOWL_TERTIARY_COLOR_G: 86, BOWL_TERTIARY_COLOR_B: 91,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 } },
  { seasonGame: 398, row: 40,
    original: { Name: 'Reliaquest Bowl', AssetName: 'Reliaquest_Bowl', BowlLogoId: 9, PresentationId: 34,
      BOWL_PRIMARY_COLOR_R: 19, BOWL_PRIMARY_COLOR_G: 30, BOWL_PRIMARY_COLOR_B: 41,
      BOWL_SECONDARY_COLOR_R: 4, BOWL_SECONDARY_COLOR_G: 138, BOWL_SECONDARY_COLOR_B: 151,
      BOWL_TERTIARY_COLOR_R: 2, BOWL_TERTIARY_COLOR_G: 96, BOWL_TERTIARY_COLOR_B: 115,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 } },
  { seasonGame: 396, row: 42,
    original: { Name: 'Sun Bowl', AssetName: 'Sun_Bowl', BowlLogoId: 7, PresentationId: 32,
      BOWL_PRIMARY_COLOR_R: 14, BOWL_PRIMARY_COLOR_G: 30, BOWL_PRIMARY_COLOR_B: 99,
      BOWL_SECONDARY_COLOR_R: 0, BOWL_SECONDARY_COLOR_G: 108, BOWL_SECONDARY_COLOR_B: 183,
      BOWL_TERTIARY_COLOR_R: 242, BOWL_TERTIARY_COLOR_G: 106, BOWL_TERTIARY_COLOR_B: 48,
      IsPlayoffBowl: false, PlayoffBracketSlot: 0 } },
];

const NY6_LEFTOVER_SLOTS_BY_SIZE = {
  2: [928, 929, 930, 931, 932, 933],
  4: [928, 929, 930, 931],
};

async function assignRealBowlsToLeftoverSlots(outputPath, schemaDirectory, assignments, log) {
  const { openSave, repackSave } = await import('./playoffEditorCore.mjs');
  const Franchise = (await import('madden-franchise')).default;

  // Exact same pattern as writeBowlGamePresentation / applyCfpConversion:
  //   Phase 1 (applyStadiumFix equivalent): raw-buffer Stadium writes
  //     on the SeasonGame records being repurposed.
  //   Phase 2 (writeBowlGamePresentation equivalent): schema-API branding
  //     writes on the week-18 regular bowl BowlGame rows, re-opened fresh.
  //
  // The week-18 regular bowl's own SeasonGame record stays exactly where
  // it is with its own teams/schedule untouched. We just overwrite:
  //   - Its BowlGame row's branding (Name/AssetName/logo/colors) with the
  //     real NY6 bowl's identity from PlayoffBowlsInfo.
  //   - The NY6 leftover slot's SeasonGame.Stadium with the real venue.
  //   - The NY6 leftover slot's teams (handled by writeGame in run-edit,
  //     before this function runs).
  //
  // The repurposed week-18 bowl's own SeasonGame record now shares its
  // BowlGame row with the NY6 slot - both games show the same real bowl
  // branding, which is correct: the week-18 game IS the real bowl game
  // now, just played at the real NY6 venue with the real NY6 teams.

  // Phase 1: raw-buffer Stadium writes on the NY6 leftover slots.
  {
    const franchise = await Franchise.create(outputPath, {
      schemaDirectory,
      schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
    });
    const playoffBowlsInfoTable = franchise.tables.find(t => t.header.tableId === 4125 && t.header.name === 'PlayoffBowlsInfo');
    if (!playoffBowlsInfoTable) { log.push('  WARNING - could not find PlayoffBowlsInfo table.'); return; }
    await playoffBowlsInfoTable.readRecords();

    const { unpackedFileContents, recordsStart, recordSize } = await openSave(outputPath, schemaDirectory);
    const buf = Buffer.from(unpackedFileContents);
    let anyWritten = false;

    for (const { record, bowlName } of assignments) {
      if (!REAL_NY6_BOWL_NAMES.includes(bowlName)) continue;
      const sourceRec = playoffBowlsInfoTable.records.find(r => { try { return r?.['Name'] === bowlName; } catch { return false; } });
      if (!sourceRec) { log.push(`  WARNING - "${bowlName}" not found in PlayoffBowlsInfo.`); continue; }
      let stadiumStr; try { stadiumStr = sourceRec['Stadium']; } catch { stadiumStr = null; }
      if (!stadiumStr) { log.push(`  WARNING - "${bowlName}" has no Stadium value.`); continue; }
      buf.writeUInt32BE(parseInt(stadiumStr, 2) >>> 0, recordsStart + record * recordSize + 4);
      anyWritten = true;
    }

    if (anyWritten) {
      const originalRawBuf = await fsPromises.readFile(outputPath);
      await fsPromises.writeFile(outputPath, repackSave(originalRawBuf, buf));
    }
  }

  // Phase 2: schema-API branding writes on the week-18 bowl rows,
  // re-opened fresh from whatever phase 1 just wrote.
  {
    const franchise = await Franchise.create(outputPath, {
      schemaDirectory,
      schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
    });
    const playoffBowlsInfoTable = franchise.tables.find(t => t.header.tableId === 4125 && t.header.name === 'PlayoffBowlsInfo');
    await playoffBowlsInfoTable.readRecords();

    const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
    const bowlTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
    await bowlTable.readRecords();

    for (const { record, bowlName } of assignments) {
      if (!REAL_NY6_BOWL_NAMES.includes(bowlName)) {
        log.push(`  WARNING - "${bowlName}" is not a recognized NY6 bowl name, skipping record ${record}.`);
        continue;
      }
      // Find which NY6_REPURPOSED_BOWLS entry maps to this SeasonGame record.
      const repurposed = NY6_REPURPOSED_BOWLS.find(b => b.seasonGame === record);
      if (!repurposed) {
        log.push(`  WARNING - no NY6_REPURPOSED_BOWLS entry for slot ${record}, skipping.`);
        continue;
      }
      const sourceRec = playoffBowlsInfoTable.records.find(r => { try { return r?.['Name'] === bowlName; } catch { return false; } });
      if (!sourceRec) { log.push(`  WARNING - "${bowlName}" not found in PlayoffBowlsInfo.`); continue; }

      const targetRec = bowlTable.records[repurposed.row];
      if (!targetRec) { log.push(`  WARNING - BowlGame row ${repurposed.row} is null.`); continue; }

      for (const field of NY6_BRANDING_FIELDS) {
        try { targetRec[field] = sourceRec[field]; } catch { /* skip */ }
      }
      try { targetRec['IsPlayoffBowl'] = true; } catch { /* skip */ }
      try { targetRec['PlayoffBracketSlot'] = 0; } catch { /* skip */ }

      log.push(`  Slot ${record} (${repurposed.seasonGame} ${repurposed.original.Name} row ${repurposed.row}): now presents as ${bowlName}.`);
    }

    await franchise.save(outputPath);
  }
}

/**
 * Writes a raw Stadium-field word directly into a target SeasonGame
 * record, for the fixed PREMIER_STADIUMS list - no team lookup needed,
 * unlike copyTeamStadiumIntoGame. buf must already be the unpacked
 * save buffer (same convention as every other raw-buffer write in this
 * file).
 */
function writeFixedStadiumIntoGame(buf, recordsStart, recordSize, seasonRecordIndex, rawWord, log, contextLabel) {
  const targetOffset = recordsStart + seasonRecordIndex * recordSize + 4; // confirmed: Stadium is byte 4, 4 bytes, on SeasonGame
  buf.writeUInt32BE(rawWord >>> 0, targetOffset);
  log.push(`  ${contextLabel}: now uses this fixed neutral-site stadium.`);
  return true;
}

/**
 * choice can be EITHER a team name (borrows that team's own home
 * stadium, original behavior) OR a name from PREMIER_STADIUMS (writes
 * the fixed raw word directly, no team lookup needed). Checked in that
 * order - a PREMIER_STADIUMS match always takes priority, since a real
 * team could theoretically share a name string with a stadium entry
 * (not expected in practice, but no reason not to be explicit).
 */
async function applyChampionshipStadiumOverride(outputPath, schemaDirectory, choice, log) {
  const { openSave, repackSave, TABLE_UNIQUE_IDS } = await import('./playoffEditorCore.mjs');
  const Franchise = (await import('madden-franchise')).default;

  const franchise = await Franchise.create(outputPath, {
    schemaDirectory,
    schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
  });

  const { unpackedFileContents, recordsStart, recordSize } = await openSave(outputPath, schemaDirectory);
  const buf = Buffer.from(unpackedFileContents);
  const CHAMPIONSHIP_RECORD = 401;

  let ok = false;
  const fixedRaw = PREMIER_STADIUMS[choice];
  if (fixedRaw !== undefined) {
    if (fixedRaw === null) {
      log.push(`  Championship location: "${choice}" is not yet confirmed for this build - no change made. See PREMIER_STADIUMS in main.cjs.`);
      return;
    }
    ok = writeFixedStadiumIntoGame(buf, recordsStart, recordSize, CHAMPIONSHIP_RECORD, fixedRaw, log, 'Championship location');
  } else {
    const teamMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.Team);
    const teamTable = teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
    await teamTable.readRecords();
    ok = await copyTeamStadiumIntoGame(franchise, teamTable, buf, recordsStart, recordSize, CHAMPIONSHIP_RECORD, choice, log, 'Championship location');
  }

  if (ok) {
    const originalRawBuf = await fsPromises.readFile(outputPath);
    const finalBuf = repackSave(originalRawBuf, buf);
    await fsPromises.writeFile(outputPath, finalBuf);
  }
}

// BowlGame field writes (Name/AssetName/BowlLogoId/colors/IsPlayoffBowl/
// PlayoffBracketSlot) - all plain scalar fields, safe via ordinary
// schema-API property assignment + franchise.save(), unlike Stadium.
// Needs the bowl's own SeasonGame record too, to resolve which
// BowlGame record it's using for each of the 4 slots.
async function writeBowlGamePresentation(outputPath, schemaDirectory, mode, log) {
  const Franchise = (await import('madden-franchise')).default;
  const franchise = await Franchise.create(outputPath, {
    schemaDirectory,
    schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
  });
  const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
  const bowlTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await bowlTable.readRecords();

  for (const bowl of CFP_REPURPOSED_BOWLS) {
    const rec = bowlTable.records[bowl.row];
    if (mode === 'convert') {
      const nativeRec = bowlTable.records[bowl.nativeRow];
      rec['Name'] = 'CFP First Round';
      rec['IsPlayoffBowl'] = true;
      rec['PlayoffBracketSlot'] = bowl.slot;
      for (const field of CFP_PRESENTATION_FIELDS) {
        try { rec[field] = nativeRec[field]; } catch { /* skip field this schema doesn't have */ }
      }
      log.push(`  CFP presentation: ${bowl.name} now presents as a true CFP First Round game (logo, jersey patch, field markings).`);
    } else {
      for (const [field, value] of Object.entries(bowl.original)) {
        rec[field] = value;
      }
      log.push(`  CFP presentation: ${bowl.name} reverted back to its original presentation.`);
    }
  }
  await franchise.save(outputPath);
}

async function applyCfpConversionMerged(outputPath, schemaDirectory, log) {
  // Merged version of applyCfpConversion: does both applyStadiumFix and
  // writeBowlGamePresentation in a single Franchise.create + openSave,
  // instead of two sequential opens. Eliminates one full save parse per
  // 16-team Apply run.
  const { openSave, repackSave, REGULAR_BOWLS, TABLE_UNIQUE_IDS } = await import('./playoffEditorCore.mjs');
  const Franchise = (await import('madden-franchise')).default;
  const { rowToName } = await import('./teamLookup.mjs');

  const franchise = await Franchise.create(outputPath, {
    schemaDirectory,
    schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
  });
  const seasonMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.SeasonGame);
  const seasonTable = seasonMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await seasonTable.readRecords();
  const teamMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.Team);
  const teamTable = teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await teamTable.readRecords();

  const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
  const bowlTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await bowlTable.readRecords();

  function getFieldObj(rec, key) { return (rec._fieldsArray || []).find(f => f._key === key); }
  function teamNameOf(rec, key) {
    const f = getFieldObj(rec, key);
    const ref = f?.referenceData;
    return ref ? rowToName(ref.rowNumber) : null;
  }

  const { unpackedFileContents, recordsStart, recordSize } = await openSave(outputPath, schemaDirectory);
  const buf = Buffer.from(unpackedFileContents);

  // Phase 1: stadium raw-buffer writes (same as applyStadiumFix)
  let fixedCount = 0;
  for (const bowl of CFP_REPURPOSED_BOWLS) {
    const bowlInfo = REGULAR_BOWLS.find(b => b.name === bowl.name);
    const seasonRecordIndex = bowlInfo?.record;
    if (seasonRecordIndex === undefined) { log.push(`  CFP presentation (${bowl.name}): could not resolve SeasonGame record - stadium not changed.`); continue; }
    const rec = seasonTable.records[seasonRecordIndex];
    if (!rec) continue;
    const hostTeam = teamNameOf(rec, 'HomeTeam');
    if (!hostTeam) { log.push(`  CFP presentation (${bowl.name}): could not determine host team - stadium not changed.`); continue; }
    const ok = await copyTeamStadiumIntoGame(franchise, teamTable, buf, recordsStart, recordSize, seasonRecordIndex, hostTeam, log, `  CFP presentation (${bowl.name})`);
    if (ok) fixedCount++;
  }
  if (fixedCount > 0) {
    const originalRawBuf = await fsPromises.readFile(outputPath);
    await fsPromises.writeFile(outputPath, repackSave(originalRawBuf, buf));
  }

  // Phase 2: BowlGame branding writes (same as writeBowlGamePresentation 'convert')
  for (const bowl of CFP_REPURPOSED_BOWLS) {
    const rec = bowlTable.records[bowl.row];
    if (!rec) continue;
    const nativeRec = bowlTable.records[bowl.nativeRow];
    rec['Name'] = 'CFP First Round';
    rec['IsPlayoffBowl'] = true;
    rec['PlayoffBracketSlot'] = bowl.slot;
    for (const field of CFP_PRESENTATION_FIELDS) {
      try { rec[field] = nativeRec[field]; } catch { /* skip field this schema doesn't have */ }
    }
    log.push(`  CFP presentation: ${bowl.name} now presents as a true CFP First Round game (logo, jersey patch, field markings).`);
  }
  await franchise.save(outputPath);
}

async function applyCfpConversion(outputPath, schemaDirectory, log) {
  return applyCfpConversionMerged(outputPath, schemaDirectory, log);
}

async function revertCfpConversion(outputPath, schemaDirectory, log) {
  await writeBowlGamePresentation(outputPath, schemaDirectory, 'revert', log);
}

/**
 * Backs up inputPath to <savesDir>/Playoff/<filename> (creating the
 * Playoff folder if needed), then returns the inputPath itself as the
 * output path so the caller can overwrite the original in place.
 * Returns null if the backup fails, so the caller can abort rather
 * than silently overwriting without a backup.
 */
async function backupToPlayoffFolder(inputPath, log) {
  try {
    const savesDir = path.dirname(inputPath);
    const playoffDir = path.join(savesDir, 'Playoff');
    await fsPromises.mkdir(playoffDir, { recursive: true });
    const filename = path.basename(inputPath);
    const backupPath = path.join(playoffDir, filename);
    await fsPromises.copyFile(inputPath, backupPath);
    log.push(`Backed up original save to ${backupPath}`);
    return inputPath; // overwrite original
  } catch (err) {
    log.push(`WARNING - could not create Playoff folder backup: ${err.message}. Aborting to protect the original save.`);
    return null;
  }
}


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 800,
    minWidth: 760,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC handlers ---

ipcMain.handle('pick-input-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your CFB27 save file',
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('pick-output-location', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save edited file as...',
    defaultPath: defaultName || 'output.sav',
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('protect-user-coach', async (event, { inputPath, outputPath }) => {
  try {
    const { protectUserCoach } = await import('./playoffEditorCore.mjs');
    const result = await protectUserCoach(inputPath, outputPath, path.join(__dirname, 'schemas'));
    return { success: true, log: result.log, fixed: result.fixed };
  } catch (err) {
    return { success: false, log: [`ERROR: ${err.message}`], fixed: [] };
  }
});

// Standalone season-stat correction, decoupled from the bracket-building
// flow entirely. correctSeasonStatsToMatchRoster normally only runs as
// a side effect of a full Apply (run-edit), which requires picking a
// valid bracket size and rebuilds bowls/ranks/CFP presentation - all
// unnecessary, and potentially confusing, once the season is actually
// over and no more bracket work is needed. This lets a user run just
// the season-stat check/fix on its own, any time - most usefully right
// after the National Championship, once the transfer portal and
// recruiting have finished moving players to new teams.
ipcMain.handle('fix-season-stats-only', async (event, { inputPath, outputPath }) => {
  const log = [];
  try {
    if (path.resolve(inputPath) !== path.resolve(outputPath)) {
      await fsPromises.copyFile(inputPath, outputPath);
    }
    log.push(`Loaded ${inputPath} - checking player season-stat team references against current rosters (no bracket changes):`);
    await correctSeasonStatsToMatchRoster(outputPath, path.join(__dirname, 'schemas'), log);
    return { success: true, log };
  } catch (err) {
    log.push(`ERROR: ${err.message}`);
    return { success: false, log, error: err.message };
  }
});

ipcMain.handle('check-user-coach', async (event, { inputPath }) => {
  try {
    const { checkUserCoachFlags } = await import('./playoffEditorCore.mjs');
    const result = await checkUserCoachFlags(inputPath, path.join(__dirname, 'schemas'));
    return { success: true, atRisk: result.atRisk };
  } catch (err) {
    return { success: false, atRisk: [], error: err.message };
  }
});

ipcMain.handle('verify-game-fingerprint', async (event, { inputPath }) => {
  try {
    const { verifyGameFingerprint } = await import('./playoffEditorCore.mjs');
    const warnings = await verifyGameFingerprint(inputPath, path.join(__dirname, 'schemas'));
    return { success: true, warnings };
  } catch (err) {
    // A thrown error here is itself a strong signal something fundamental
    // doesn't match what this tool expects - surface it the same way.
    return { success: true, warnings: [`Could not even open this save to check - ${err.message}. This may mean the game has been updated since this tool was built.`] };
  }
});

ipcMain.handle('get-team-list', async () => {
  const { lookup } = await import('./teamLookup.mjs');
  return Object.keys(lookup).sort();
});

ipcMain.handle('get-regular-bowls', async () => {
  const { REGULAR_BOWLS } = await import('./playoffEditorCore.mjs');
  return REGULAR_BOWLS.map(b => b.name);
});

ipcMain.handle('get-premier-stadiums', async () => {
  // Only expose names with a confirmed (non-null) raw word - the
  // pending/TODO ones stay hidden from the picker until they're
  // actually verified against a real save, same standard as everything
  // else in this feature.
  return Object.entries(PREMIER_STADIUMS)
    .filter(([, raw]) => raw !== null)
    .map(([name]) => name)
    .sort();
});

ipcMain.handle('get-ny6-leftover-slots', async (event, { bracketSize, inputPath }) => {
  const records = NY6_LEFTOVER_SLOTS_BY_SIZE[bracketSize] || [];
  if (!records.length) return { slots: [], bowlNames: REAL_NY6_BOWL_NAMES };

  if (!inputPath) {
    return { slots: records.map((r, i) => ({ record: r, bowlLabel: `Game ${i + 1} of ${records.length}`, home: null, away: null })), bowlNames: REAL_NY6_BOWL_NAMES };
  }

  try {
    const { openSave, readMatchup, TEAM_TABLE_ID } = await import('./playoffEditorCore.mjs');
    const { rowToName } = await import('./teamLookup.mjs');
    const Franchise = (await import('madden-franchise')).default;
    const schemaDirectory = path.join(__dirname, 'schemas');

    const { unpackedFileContents, recordsStart, recordSize } = await openSave(inputPath, schemaDirectory);
    const buf = Buffer.from(unpackedFileContents);

    // Build Stadium raw word -> bowl name from PlayoffBowlsInfo.
    // This is the most reliable source - PlayoffBowlsInfo is never
    // touched by any of our writes, and we confirmed its Stadium values
    // match the SeasonGame Stadium field values for each real bowl.
    const franchise = await Franchise.create(inputPath, {
      schemaDirectory,
      schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
    });
    const playoffBowlsInfoTable = franchise.tables.find(t => t.header.tableId === 4125 && t.header.name === 'PlayoffBowlsInfo');
    await playoffBowlsInfoTable.readRecords();
    const stadiumWordToBowlName = new Map();
    for (const pbRec of playoffBowlsInfoTable.records) {
      if (!pbRec) continue;
      let stadiumStr, name;
      try { stadiumStr = pbRec['Stadium']; name = pbRec['Name']; } catch { continue; }
      if (stadiumStr && name) {
        const word = parseInt(stadiumStr, 2);
        stadiumWordToBowlName.set(word, name);
      }
    }

    const seasonGameTable = franchise.tables.find(t => t.header.name === 'SeasonGame' && t.header.recordCapacity === 983);
    await seasonGameTable.readRecords();

    const slotsWithTeams = records.map(r => {
      const m = readMatchup(buf, recordsStart, recordSize, r);
      const homeIsFbs = m.home.tableId === TEAM_TABLE_ID;
      const awayIsFbs = m.away.tableId === TEAM_TABLE_ID;
      // Read Stadium raw word from SeasonGame at the confirmed offset (+4).
      const stadiumWord = buf.readUInt32BE(recordsStart + r * recordSize + 4);
      const bowlLabel = stadiumWordToBowlName.get(stadiumWord) || `Slot ${r}`;
      return {
        record: r,
        bowlLabel,
        home: homeIsFbs ? rowToName(m.home.row) : null,
        away: awayIsFbs ? rowToName(m.away.row) : null,
      };
    });
    return { slots: slotsWithTeams, bowlNames: REAL_NY6_BOWL_NAMES };
  } catch (err) {
    return { slots: records.map((r, i) => ({ record: r, bowlLabel: `Game ${i + 1} of ${records.length}`, home: null, away: null })), bowlNames: REAL_NY6_BOWL_NAMES };
  }
});

ipcMain.handle('get-team-conferences', async () => {
  const { loadTeamConference } = await import('./teamConference.mjs');
  const { TEAM_CONFERENCE, ALL_CONFERENCES } = loadTeamConference();
  return { TEAM_CONFERENCE, ALL_CONFERENCES };
});

ipcMain.handle('get-team-colors', async () => {
  const { TEAM_COLORS } = await import('./teamColors.mjs');
  return TEAM_COLORS;
});

ipcMain.handle('compute-bcs-rankings', async (event, { inputPath, options }) => {
  try {
    const { openSave, findConferenceChampionsByStandings, resolveTable, TABLE_UNIQUE_IDS: TUI } = await import('./playoffEditorCore.mjs');
    const { computeFullBCSRankings } = await import('./bcsRankingFull.mjs');
    const { loadTeamConference } = await import('./teamConference.mjs');
    const { TEAM_CONFERENCE } = loadTeamConference();
    const Franchise = (await import('madden-franchise')).default;

    const { unpackedFileContents, recordsStart, recordSize, recordCount } =
      await openSave(inputPath, path.join(__dirname, 'schemas'));
    const buf = Buffer.from(unpackedFileContents);

    // Schema-aware SeasonGame table, needed for the SeasonWeekType-based
    // filter in computeGameLogs - CONFIRMED via real save testing that
    // the raw-buffer week reading disagreed with this schema-safe
    // reading on 100% of games, so this can't be derived from buf alone.
    const franchiseForWeekType = await Franchise.create(inputPath, {
      schemaDirectory: path.join(__dirname, 'schemas'),
      schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(__dirname, 'schemas', '486_1.gz') },
    });
    const seasonGameTable = resolveTable(franchiseForWeekType, TUI.SeasonGame, 'SeasonGame');
    await seasonGameTable.readRecords();

    const { confChampions: champResults, unresolved } = await findConferenceChampionsByStandings(
      buf, recordsStart, recordSize, recordCount, TEAM_CONFERENCE, inputPath, path.join(__dirname, 'schemas')
    );
    const confChampions = {};
    for (const [conf, info] of Object.entries(champResults)) {
      confChampions[conf] = info.winner;
    }
    const unmatchedConfGames = unresolved.map(u => ({ home: u.conf, away: '', winner: `unresolved: ${u.reason}` }));

    const rankings = computeFullBCSRankings(buf, recordsStart, recordSize, recordCount, confChampions, seasonGameTable, { ...(options || {}), teamConference: TEAM_CONFERENCE });
    return { success: true, rankings, unmatchedConfGames };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-customizable-bowls', async (event, { bracketSize }) => {
  try {
    const { REGULAR_BOWLS } = await import('./playoffEditorCore.mjs');
    const CHAMPIONSHIP = 401;
    // Exactly what each bracket size occupies natively, per the
    // confirmed BRACKET_SLOT_MAPS layout already used for writing:
    //   2:  Championship only
    //   4:  Semifinals (932,933) + Championship
    //   8:  Quarterfinals/NY6 (928-931) + Championship
    //   12: native Round1 (924-927) + Quarterfinals (928-931) + Semis (932,933) + Championship
    //   16: same as 12, PLUS the 4 repurposed bowls borrowed as extra Round 1 slots
    const RESERVED_BY_SIZE = {
      2: [CHAMPIONSHIP],
      4: [932, 933, CHAMPIONSHIP],
      8: [928, 929, 930, 931, CHAMPIONSHIP],
      12: [924, 925, 926, 927, 928, 929, 930, 931, 932, 933, CHAMPIONSHIP],
      16: [924, 925, 926, 927, 928, 929, 930, 931, 932, 933, CHAMPIONSHIP, 371, 370, 380, 375],
    };
    const reserved = new Set(RESERVED_BY_SIZE[bracketSize] || []);
    const customizable = REGULAR_BOWLS.filter(b => !reserved.has(b.record));
    return { success: true, bowls: customizable };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('apply-standalone-rankings', async (event, { inputPath, outputPath, options }) => {
  const log = [];
  try {
    const { openSave, findConferenceChampionsByStandings, resolveTable, TABLE_UNIQUE_IDS: TUI } = await import('./playoffEditorCore.mjs');
    const { computeFullBCSRankings } = await import('./bcsRankingFull.mjs');
    const { loadTeamConference } = await import('./teamConference.mjs');
    const { teamRow, rowToName } = await import('./teamLookup.mjs');
    const { TEAM_CONFERENCE } = loadTeamConference();
    const Franchise = (await import('madden-franchise')).default;

    const safeOutputPath = backupToPlayoffFolder(inputPath, log);
    if (!safeOutputPath) return { success: false, log, error: 'Backup failed - aborting.' };
    const resolvedOutputPath = outputPath || safeOutputPath;

    // Same computation path as compute-bcs-rankings (used for the
    // preview table) - this just also writes the result, standalone,
    // with no bracket involved at all. Ranks 1-25 come straight from
    // the ranking engine's own order, no seed carve-out.
    const { unpackedFileContents, recordsStart, recordSize, recordCount } =
      await openSave(inputPath, path.join(__dirname, 'schemas'));
    const buf = Buffer.from(unpackedFileContents);

    // Same SeasonWeekType-based requirement as compute-bcs-rankings -
    // see that handler's comment for why this can't come from buf alone.
    const franchiseForWeekType = await Franchise.create(inputPath, {
      schemaDirectory: path.join(__dirname, 'schemas'),
      schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(__dirname, 'schemas', '486_1.gz') },
    });
    const seasonGameTable = resolveTable(franchiseForWeekType, TUI.SeasonGame, 'SeasonGame');
    await seasonGameTable.readRecords();

    const { confChampions: champResults, unresolved } = await findConferenceChampionsByStandings(
      buf, recordsStart, recordSize, recordCount, TEAM_CONFERENCE, inputPath, path.join(__dirname, 'schemas')
    );
    const confChampions = {};
    for (const [conf, info] of Object.entries(champResults)) confChampions[conf] = info.winner;

    const rankings = computeFullBCSRankings(buf, recordsStart, recordSize, recordCount, confChampions, seasonGameTable, { ...(options || {}), teamConference: TEAM_CONFERENCE });
    const rankingOrder = rankings.map(r => r.name);
    log.push(`Computed rankings for ${rankingOrder.length} teams.`);
    if (unresolved.length) log.push(`Note: ${unresolved.length} conference championship game(s) could not be resolved - see the preview table before trusting this fully.`);

    // inputPath and outputPath may be the same file (overwriting in
    // place) or different (writing a fresh copy) - same convention as
    // every other Apply action in this tool.
    if (inputPath !== resolvedOutputPath) await fsPromises.copyFile(inputPath, resolvedOutputPath);

    const franchise = await Franchise.create(resolvedOutputPath, {
      schemaDirectory: path.join(__dirname, 'schemas'),
      autoParse: true,
      schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(__dirname, 'schemas', '486_1.gz') },
    });
    const teamTable = resolveTable(franchise, TUI.Team, 'Team');
    await teamTable.readRecords();
    await syncPollRanks(teamTable, [], rankingOrder, teamRow, rowToName, log);
    await franchise.save();
    log.push(`Saved to ${resolvedOutputPath}.`);

    return { success: true, log, rankings };
  } catch (err) {
    log.push(`ERROR: ${err.message}`);
    return { success: false, log, error: err.message };
  }
});

ipcMain.handle('detect-conference-champions', async (event, { inputPath }) => {
  try {
    const { openSave, findConferenceChampionsByStandings } = await import('./playoffEditorCore.mjs');
    const { loadTeamConference } = await import('./teamConference.mjs');
    const { TEAM_CONFERENCE } = loadTeamConference();

    const { unpackedFileContents, recordsStart, recordSize, recordCount } =
      await openSave(inputPath, path.join(__dirname, 'schemas'));
    const buf = Buffer.from(unpackedFileContents);

    // FIXED: see compute-bcs-rankings for the same fix and why.
    const { confChampions: champResults, unresolved } = await findConferenceChampionsByStandings(
      buf, recordsStart, recordSize, recordCount, TEAM_CONFERENCE, inputPath, path.join(__dirname, 'schemas')
    );
    const champions = {};
    for (const [conf, info] of Object.entries(champResults)) {
      champions[conf] = info.winner;
    }
    const unmatched = unresolved.map(u => ({ home: u.conf, away: '', winner: `unresolved: ${u.reason}` }));
    return { success: true, champions, unmatched };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Slot mapping for each supported bracket size, based on everything
// validated this session:
//  - 2-team:  seed the Championship game directly - record 401, confirmed
//             by searching a real save for the two actual finalists
//             (Georgia/Miami) via diagnose-championship-slot.mjs. It sits
//             immediately after the 32 regular bowls (369-400), which
//             tracks: the National Championship is always the last game
//             of the season on the calendar, same reasoning that already
//             held for the other fixed record indices.
//  - 4-team:  seed the Semifinal slots directly as "Round 1" -> auto to Championship
//  - 8-team:  seed the Quarterfinal slots directly as "Round 1" (both sides) -> auto to SF -> auto to Championship
//  - 16-team: Round 1 = native First Round (4) + 4 repurposed regular bowls (8 total)
//             Round 2 = manual reseed into the Quarterfinal slots (both sides) -> auto to SF -> auto to Championship
// Army-Navy is always scheduled for the last week of the season by the
// game itself, regardless of what conference either team is assigned to
// (confirmed - this holds true whether they're Independent or have been
// custom-realigned into the same real conference). It is never actually
// that conference's championship game, so it must be excluded from
// conference-champion detection even when both teams share a conference -
// the normal "same conference, not Independent" check alone isn't enough
// to catch this specific case.
function isArmyNavyGame(homeName, awayName) {
  const pair = new Set([homeName, awayName]);
  return pair.has('Army') && pair.has('Navy');
}

// Playoff slot record indices - confirmed from vanilla save diagnostic
// (DYNASTY-VANILLA, schema 472_0, completely unmodified):
//
//   Week 17 / BowlSeason1: records 924-927 = 4 real CFP Round 1 games
//     (records 370-400 in same week = regular bowl games, NOT touched)
//   Week 18 / BowlSeason2: records 928-931 = 4 CFP QF games (NY6 bowls)
//     (records 369-400 in same week = regular bowl games, NOT touched)
//   Week 19 / BowlSeason3: records 932-933 = 2 Semifinal games
//   Week 20 / NationalChampionship: record 401 = Championship
//
// CONFIRMED behavior per bracket size:
//
//   16-team: Overwrites weeks 17 AND 18, but in two separate passes.
//            Pass 1 (Bowl Week 1): writes 924-927 + 4 repurposed bowl slots.
//            Pass 2 (after Week 17 plays out): writes 928-931 (QF reseed).
//
//   12-team: Overwrites weeks 17 AND 18 in a single pass at Bowl Week 1.
//            Writes 924-927 (Round 1) + 928-931 (QF byes for seeds 1-4).
//            No second pass needed - game handles QF re-seeding natively.
//
//    8-team: Overwrites week 18 ONLY. Run at Bowl Week 2 (after Week 17
//            Round 1 has played out). Writes 928-931. Game handles
//            Semis and Championship automatically.
//
//    4-team: Overwrites week 19 ONLY. Run at Bowl Week 3 (after weeks
//            17+18 have played out). Writes 932-933. Championship auto.
//
//    2-team: Overwrites week 20 ONLY. Run at Bowl Week 4 (after weeks
//            17+18+19 have played out). Writes 401.
const BRACKET_SLOT_MAPS = {
  2: { round1: [401] },
  4: { round1: [932, 933] },
  8: { round1: [928, 929, 930, 931] },
  12: {
    round1: [924, 925, 926, 927],
    quarterfinals: [928, 929, 930, 931],
  },
  16: {
    round1Native: [924, 925, 926, 927],
    round1BowlNames: ['Boca Raton Bowl', 'New Orleans Bowl', 'Cure Bowl', 'Gasparilla Bowl'],
    round2: [928, 929, 930, 931],
  },
};

// Single source of truth for "which SeasonGame records is THIS specific
// run allowed to change the play-status of" - restated directly from the
// confirmed bracket-size rules:
//   16-team Pass 1 (Week 17): 924-927 + the 4 repurposed bowls.
//   16-team Pass 2 (Week 18, after Week 17 plays): 928-931 ONLY - must
//     NOT touch 924-927 again, those already have real results.
//   12-team (Week 17, single pass): 924-927 AND 928-931.
//   8-team (Week 18 only): 928-931 ONLY.
//   4-team (Week 19 only): 932-933 ONLY.
//   2-team (Week 20 only): 401 ONLY.
// Used both to scope the GameStatus reset (already existed) and, new,
// to verify after the fact that nothing outside this set actually
// changed - see verifyNoCollateralStatusChanges below. Previously the
// reset was scoped correctly in JS, but nothing checked whether the
// underlying save library's full-table read+write round trip silently
// disturbed records we never intended to touch (confirmed real: an
// 8-team run reverted already-played Week 17 results, which this set
// would never have permitted).
function getAllowedRecordsForThisRun(config, slotMap, REGULAR_BOWLS) {
  const allowed = new Set();
  if (config.bracketSize === 16) {
    const isPass1 = !!(config.round1 && config.round1.length);
    if (isPass1) {
      (slotMap.round1Native || []).forEach(r => allowed.add(r));
      (slotMap.round1BowlNames || []).forEach(name => {
        const b = REGULAR_BOWLS.find(bb => bb.name === name);
        if (b) allowed.add(b.record);
      });
    } else {
      (slotMap.round2 || []).forEach(r => allowed.add(r));
    }
  } else if (config.bracketSize === 12) {
    (slotMap.round1 || []).forEach(r => allowed.add(r));
    (slotMap.quarterfinals || []).forEach(r => allowed.add(r));
  } else {
    (slotMap.round1 || []).forEach(r => allowed.add(r));
  }
  return allowed;
}

// Takes an already-open, already-readRecords'd SeasonGame table (from
// openSaveWithTeamTable, which run-edit already calls anyway) and
// snapshots the 3 status fields we care about. Eliminates the original
// Franchise.create call here - saves one full save parse per Apply.
function snapshotSeasonGameStatusFromTable(seasonGameTable) {
  const snapshot = [];
  for (let i = 0; i < seasonGameTable.records.length; i++) {
    const rec = seasonGameTable.records[i];
    if (!rec) { snapshot.push(null); continue; }
    let status, isSimmed, published;
    try { status = rec['GameStatus']; } catch { status = undefined; }
    try { isSimmed = rec['IsSimmed']; } catch { isSimmed = undefined; }
    try { published = rec['HasBeenPublished']; } catch { published = undefined; }
    snapshot.push({ status, isSimmed, published });
  }
  return snapshot;
}

async function snapshotSeasonGameStatus(inputPath, schemaDirectory) {
  const Franchise = (await import('madden-franchise')).default;
  const { resolveTable, TABLE_UNIQUE_IDS: TUI } = await import('./playoffEditorCore.mjs');
  const fr = await Franchise.create(inputPath, {
    schemaDirectory,
    schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
  });
  const t = resolveTable(fr, TUI.SeasonGame, 'SeasonGame');
  await t.readRecords();
  return snapshotSeasonGameStatusFromTable(t);
}


// Compares a pre-write snapshot (captured in memory BEFORE any writes -
// see snapshotSeasonGameStatus, called at the top of run-edit) against
// the freshly-written output file. CONFIRMED BUG in the first version of
// this check: it re-opened inputPath AFTER the write already happened
// when inputPath and outputPath were the same file (a completely normal
// thing to do - overwriting your own save in place) - so it was
// comparing the after-state against itself and could never catch
// anything. Capturing the snapshot in memory up front fixes this
// regardless of whether input and output end up being the same path.
// Verifies using an already-open SeasonGame table (from the rank-sync
// franchise2 that's already open at this point in run-edit), eliminating
// the original Franchise.create call here.
function verifyNoCollateralStatusChangesFromTable(beforeSnapshot, seasonGameTable, allowedRecords) {
  const violations = [];
  const count = Math.min(beforeSnapshot.length, seasonGameTable.records.length);
  for (let i = 0; i < count; i++) {
    if (allowedRecords.has(i)) continue;
    const before = beforeSnapshot[i];
    const after = seasonGameTable.records[i];
    if (!before || !after) continue;
    for (const field of ['status', 'isSimmed', 'published']) {
      const schemaField = field === 'status' ? 'GameStatus' : field === 'isSimmed' ? 'IsSimmed' : 'HasBeenPublished';
      let aVal;
      try { aVal = after[schemaField]; } catch { continue; }
      if (before[field] !== undefined && before[field] !== aVal) {
        violations.push(`Record ${i}: ${schemaField} changed from ${before[field]} to ${aVal} - this record is OUTSIDE this run's allowed set and should not have changed.`);
      }
    }
  }
  return violations;
}

async function verifyNoCollateralStatusChanges(beforeSnapshot, outputPath, schemaDirectory, allowedRecords) {
  const Franchise = (await import('madden-franchise')).default;
  const { resolveTable, TABLE_UNIQUE_IDS: TUI } = await import('./playoffEditorCore.mjs');
  const fr = await Franchise.create(outputPath, {
    schemaDirectory,
    schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
  });
  const afterTable = resolveTable(fr, TUI.SeasonGame, 'SeasonGame');
  await afterTable.readRecords();
  return verifyNoCollateralStatusChangesFromTable(beforeSnapshot, afterTable, allowedRecords);
}


ipcMain.handle('detect-conferences-from-schedule', async (event, { inputPath, attempts }) => {
  let exactMethodError = null;

  // Try the exact method first: read real conference membership straight
  // from the Conference table's TeamSlots field via the schema-aware API.
  // This is deterministic and exact - no statistical guessing needed. Only
  // fall back to schedule-based inference if this fails for some reason
  // (e.g. a schema version without this table/field).
  try {
    const Franchise = (await import('madden-franchise')).default;
    const { getConferenceMemberships } = await import('./conferenceMemberships.mjs');
    const { rowToName } = await import('./teamLookup.mjs');

    const franchise = await Franchise.create(inputPath, {
      schemaDirectory: path.join(__dirname, 'schemas'),
      autoParse: true,
      schemaOverride: {
        major: 486,
        minor: 1,
        gameYear: 27,
        path: path.join(__dirname, 'schemas', '486_1.gz'),
      },
    });
    const { conferences, debug } = await getConferenceMemberships(franchise);

    if (conferences.length > 0) {
      const clusters = conferences.map(c => ({
        suggestedName: c.name,
        teams: c.members.map(row => rowToName(row)).filter(n => n && !n.startsWith('UNKNOWN_PLACEHOLDER')).sort(),
      })).filter(c => c.teams.length > 0);

      if (clusters.length > 0) {
        return { success: true, clusters, method: 'exact' };
      }
      exactMethodError = `Exact method ran but found 0 non-empty conferences after filtering. Debug: ${JSON.stringify(debug)}`;
    } else {
      exactMethodError = `Exact method ran but the Conference table had 0 usable records. Debug: ${JSON.stringify(debug)}`;
    }
  } catch (err) {
    exactMethodError = `${err.message}${err.stack ? '\n' + err.stack.split('\n').slice(0, 3).join('\n') : ''}`;
  }

  try {
    const { openSave } = await import('./playoffEditorCore.mjs');
    const { computeGameLogs } = await import('./bcsRankingFull.mjs');
    const { detectCommunities } = await import('./conferenceDetection.mjs');
    const { rowToName } = await import('./teamLookup.mjs');
    const { loadTeamConference } = await import('./teamConference.mjs');
    const { TEAM_CONFERENCE } = loadTeamConference();

    const { unpackedFileContents, recordsStart, recordSize, recordCount } =
      await openSave(inputPath, path.join(__dirname, 'schemas'));
    const buf = Buffer.from(unpackedFileContents);

    const { games } = computeGameLogs(buf, recordsStart, recordSize, recordCount);
    const gamePairs = games.map(g => [g.home, g.away]);

    if (gamePairs.length < 20) {
      return {
        success: false,
        error: `Exact method failed (${exactMethodError}). Statistical fallback also failed: only found ${gamePairs.length} completed regular-season game(s) in this save. Try simming further, or use the manual teamConferenceOverrides.json approach instead.`,
      };
    }

    const communities = detectCommunities(gamePairs, attempts || 20);

    const groups = new Map();
    for (const [row, c] of communities.entries()) {
      const name = rowToName(row);
      if (!name || name.startsWith('UNKNOWN_PLACEHOLDER')) continue;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(name);
    }

    // Suggest a name for each detected cluster based on which default
    // conference its members overlap with most - just a starting point,
    // never presented as certain.
    const clusters = [...groups.entries()].map(([id, teams]) => {
      const overlapCounts = {};
      for (const t of teams) {
        const defaultConf = TEAM_CONFERENCE[t];
        if (defaultConf) overlapCounts[defaultConf] = (overlapCounts[defaultConf] || 0) + 1;
      }
      const suggestedName = Object.entries(overlapCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || `Conference ${id + 1}`;
      return { suggestedName, teams: teams.sort() };
    }).sort((a, b) => b.teams.length - a.teams.length);

    return { success: true, clusters, method: 'statistical', exactMethodError };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-conference-overrides-exist', async () => {
  try {
    const overridesPath = path.join(__dirname, 'teamConferenceOverrides.json');
    return { success: true, exists: fs.existsSync(overridesPath) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-conference-overrides', async (event, { overrides }) => {
  try {
    const fs2 = await import('node:fs');
    const overridesPath = path.join(__dirname, 'teamConferenceOverrides.json');
    fs2.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Bracket History - a manually-saved record of a completed bracket for
// a given year, stored alongside the app (same convention as
// teamConferenceOverrides.json) rather than inside the dynasty save
// itself, since the save's playoff records get overwritten every
// season and there's no in-save "which year was this" field this tool
// has confirmed access to. Saving is a deliberate button-press (once a
// champion exists), not automatic - so testing/re-running the tool
// against the same season doesn't spam the history with duplicates,
// and the year itself is user-entered (pre-filled with a suggestion)
// rather than inferred, since the person doing the save is the one who
// actually knows what season this is.
const BRACKET_HISTORY_PATH = path.join(__dirname, 'bracketHistory.json');

function readBracketHistoryFile() {
  if (!fs.existsSync(BRACKET_HISTORY_PATH)) return [];
  try {
    const raw = fs.readFileSync(BRACKET_HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

ipcMain.handle('get-bracket-history', async () => {
  try {
    const entries = readBracketHistoryFile().slice().sort((a, b) => a.year - b.year);
    return { success: true, entries };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-bracket-to-history', async (event, { year, bracketSize, rounds, champion, championCoach }) => {
  try {
    if (!year || !Number.isInteger(year)) {
      return { success: false, error: 'A valid year is required.' };
    }
    const entries = readBracketHistoryFile();
    const existingIndex = entries.findIndex(e => e.year === year);
    const entry = { year, bracketSize, rounds, champion, championCoach: championCoach || null, savedAt: new Date().toISOString() };
    const overwrote = existingIndex !== -1;
    if (overwrote) entries[existingIndex] = entry;
    else entries.push(entry);
    fs.writeFileSync(BRACKET_HISTORY_PATH, JSON.stringify(entries, null, 2));
    return { success: true, overwrote };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-conference-mismatch', async (event, { inputPath }) => {
  try {
    const Franchise = (await import('madden-franchise')).default;
    const { getConferenceMemberships } = await import('./conferenceMemberships.mjs');
    const { rowToName } = await import('./teamLookup.mjs');
    const { loadTeamConference } = await import('./teamConference.mjs');
    const { TEAM_CONFERENCE } = loadTeamConference();

    const franchise = await Franchise.create(inputPath, {
      schemaDirectory: path.join(__dirname, 'schemas'),
      autoParse: true,
      schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(__dirname, 'schemas', '486_1.gz') },
    });
    const { conferences } = await getConferenceMemberships(franchise);

    if (!conferences.length) {
      // Exact method isn't available for this save (different schema, etc.)
      // - nothing to silently self-check against, so just say so quietly.
      return { success: false, error: 'Exact method unavailable for this save.' };
    }

    const exactMap = {};
    for (const c of conferences) {
      for (const row of c.members) {
        const name = rowToName(row);
        if (name && !name.startsWith('UNKNOWN_PLACEHOLDER')) exactMap[name] = c.name;
      }
    }

    const mismatches = [];
    for (const [team, actualConf] of Object.entries(exactMap)) {
      const currentConf = TEAM_CONFERENCE[team];
      if (currentConf && currentConf !== actualConf) {
        mismatches.push({ team, current: currentConf, actual: actualConf });
      }
    }

    // Same shape as the manual detect-and-review flow's clusters, so the
    // "Review & update" action can drop straight into the existing editor.
    const exactConferences = conferences.map(c => ({
      suggestedName: c.name,
      teams: c.members.map(r => rowToName(r)).filter(n => n && !n.startsWith('UNKNOWN_PLACEHOLDER')).sort(),
    }));

    return { success: true, mismatches, exactConferences };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Read-only. Returns the current state of every CFP-adjacent record for
// the given bracket size, straight from the save - no writes, no risk to
// anything else. Does NOT decide what's "ghosted" (not yet reached) -
// that's intentionally left to the renderer, which tracks which rounds
// the tool has actually applied *in this session*. Reading a record's
// team names alone can't reliably tell "user's real Round 2 pick" apart
// from "native leftover default data" - they're structurally identical -
// so ghosting by save-content-inference would be guessing, not truth.
ipcMain.handle('get-bracket-state', async (event, { inputPath, bracketSize }) => {
  try {
    const { openSave, readMatchup, readRecordBits, WINNER_BIT, REGULAR_BOWLS, TEAM_TABLE_ID, resolveTable, TABLE_UNIQUE_IDS: TUI } = await import('./playoffEditorCore.mjs');
    const { rowToName, teamRow } = await import('./teamLookup.mjs');
    const Franchise = (await import('madden-franchise')).default;

    const { unpackedFileContents, recordsStart, recordSize } =
      await openSave(inputPath, path.join(__dirname, 'schemas'));
    const buf = Buffer.from(unpackedFileContents);

    const fr = await Franchise.create(inputPath, {
      schemaDirectory: path.join(__dirname, 'schemas'),
      schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(__dirname, 'schemas', '486_1.gz') },
    });
    const seasonTable = resolveTable(fr, TUI.SeasonGame, 'SeasonGame');
    await seasonTable.readRecords();

    // Raw read, file field order exactly as stored - no swap correction
    // here. The swap only applies to records OUR OWN tool wrote (see
    // writeGame's comment in run-edit: our app's "home"/better seed
    // always lands in the file's AwayTeam field, and our "away"/worse
    // seed in the file's HomeTeam field). Games the real game engine
    // fills in natively (Semifinals, Championship, a 12-team bye's
    // "waiting" slot once actually played) follow whatever convention
    // the game itself uses - unverified - so those stay raw/un-swapped.
    //
    // Winner determination: confirmed via a real save (national
    // championship, Notre Dame 31 - Ohio State 29) that the schema's
    // named GameStatus field does NOT use the same home/away labeling
    // as readMatchup's home/away fields - GameStatus said "AwayWon"
    // while the real winner (Notre Dame) was sitting in the field
    // readMatchup calls "home". WINNER_BIT, read the same raw-bit way
    // get-round1-status already does successfully, agreed with reality
    // (0 = home field won = Notre Dame, correct). So winner comes from
    // WINNER_BIT + readMatchup, matching the proven method elsewhere.
    //
    // Completion gate: NOT GameStatus, and NOT IsSimmed either - both
    // confirmed via a real 12-team save to already show a "decided"-
    // looking value (GameStatus=HomeWon/AwayWon, IsSimmed=true) the
    // moment you simply ENTER a week, before that week has actually
    // been played through - a provisional/projected result, not a
    // final one. HasBeenPublished was confirmed false on every record
    // in that same save regardless of whether its week was in-progress
    // or not yet reached at all - the one field that actually tracks
    // "this result is real and locked in," which is exactly what
    // gating needs.
    function readGameRaw(recordIndex) {
      const m = readMatchup(buf, recordsStart, recordSize, recordIndex);
      if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) {
        return { home: null, away: null, winner: null, status: null };
      }
      const homeName = rowToName(m.home.row);
      const awayName = rowToName(m.away.row);
      let hasBeenPublished = null;
      try { hasBeenPublished = seasonTable.records[recordIndex]['HasBeenPublished']; } catch { /* leave null */ }
      let winner = null;
      if (hasBeenPublished === true) {
        const recStart = recordsStart + recordIndex * recordSize;
        const recordBuf = buf.subarray(recStart, recStart + recordSize);
        const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
        winner = winnerBit === 0 ? homeName : awayName;
      }
      return { home: homeName, away: awayName, winner, hasBeenPublished };
    }
    const isComplete = (recordIndex) => !!readGameRaw(recordIndex).winner;

    const slotMap = BRACKET_SLOT_MAPS[bracketSize];
    if (!slotMap) return { success: false, error: `No slot map for bracket size ${bracketSize}` };

    // Seed lookup built as we go: the save file never stores a seed
    // number on a game record, only team identity, so once a team's
    // seed is known (Round 1's fixed formula, or a 12-team bye) it's
    // remembered by name so a later round (a winner advancing) can
    // still show it.
    const seedByName = {};

    // Round 0 (the very first round our tool ever writes for this
    // bracket size - Round 1 for every size except 12, where it's the
    // 5v12/6v11/7v10/8v9 games) always goes through writeGame, which
    // ALWAYS swaps: our app's better seed ends up in the file's AwayTeam
    // field. So the file's away field belongs on top, home on the
    // bottom - opposite of raw field order - and the seed number is
    // knowable directly from the game index via seedFor(i).
    function pushRound0(recordIndices, seedFor) {
      const flat = [];
      recordIndices.forEach((rec, i) => {
        const g = readGameRaw(rec);
        const { better, worse } = seedFor(i);
        if (g.away) seedByName[g.away] = better;
        if (g.home) seedByName[g.home] = worse;
        flat.push({ name: g.away, seed: g.away ? better : null });
        flat.push({ name: g.home, seed: g.home ? worse : null });
      });
      rounds.push(flat);
    }

    // Any later, auto-advanced round (Semifinal, Championship). If the
    // game(s) feeding it haven't actually been decided yet, whatever
    // team name currently sits in that record is native leftover/
    // default data, not a real result - force TBD rather than show it.
    // Read in raw field order since the game's own auto-advance
    // hasn't been confirmed to follow our write convention.
    function pushAutoRound(recordIndices, sourceComplete) {
      const flat = [];
      recordIndices.forEach(rec => {
        const g = readGameRaw(rec);
        const home = sourceComplete ? g.home : null;
        const away = sourceComplete ? g.away : null;
        flat.push({ name: home, seed: home ? (seedByName[home] ?? null) : null });
        flat.push({ name: away, seed: away ? (seedByName[away] ?? null) : null });
      });
      rounds.push(flat);
    }

    // 16-team's Round 2 (Quarterfinals) is a manual reseed our tool
    // also writes via writeGame (same swap applies), but which teams
    // land there is the user's manual choice, not a fixed seed formula
    // - so attach a seed only if the name lookup already knows one.
    function pushManualReseedRound(recordIndices) {
      const flat = [];
      recordIndices.forEach(rec => {
        const g = readGameRaw(rec);
        flat.push({ name: g.away, seed: g.away ? (seedByName[g.away] ?? null) : null });
        flat.push({ name: g.home, seed: g.home ? (seedByName[g.home] ?? null) : null });
      });
      rounds.push(flat);
    }

    // 12-team's Quarterfinal round is a mix: the bye half (file's away
    // field, per the same writeGame swap) is always real, written
    // directly by our tool; the other half only becomes real once that
    // specific Round 1 game has actually been decided. Byes are
    // written in DESCENDING seed order (seed 4 at index 0, seed 1 at
    // index 3) so each lands next to the Round 1 game it actually
    // plays - see the config.quarterfinals comment in btnApply.
    function pushTwelveTeamQuarterfinals(recordIndices, round1Complete) {
      const flat = [];
      recordIndices.forEach((rec, i) => {
        const g = readGameRaw(rec);
        const byeSeed = 4 - i;
        if (g.away) seedByName[g.away] = byeSeed;
        const waitingName = round1Complete[i] ? g.home : null;
        flat.push({ name: g.away, seed: g.away ? byeSeed : null });
        flat.push({ name: waitingName, seed: waitingName ? (seedByName[waitingName] ?? null) : null });
      });
      rounds.push(flat);
    }

    const rounds = [];
    // Gates the `champion` field below on the SAME completion signal
    // already used to decide whether to show real team names in the
    // Championship round display - previously `champion` ignored this
    // entirely and trusted record 401's raw GameStatus regardless of
    // whether the bracket had actually reached that point. Record 401
    // can carry a leftover/native GameStatus unrelated to this bracket
    // (same root cause as every other auto-advanced-round bug fixed
    // earlier) - confirmed by a real report where the tool displayed a
    // "champion" while the rest of the bracket was still correctly
    // showing incomplete/TBD. For 2-team, the Championship IS the only
    // round, so there's no separate feeder to gate on - readGameRaw's
    // own winner-or-null already handles it correctly.
    let championshipFeederComplete = true;

    if (bracketSize === 16) {
      const round1Records = [
        ...slotMap.round1Native,
        ...slotMap.round1BowlNames.map(name => REGULAR_BOWLS.find(b => b.name === name).record),
      ];
      pushRound0(round1Records, (i) => ({ better: i + 1, worse: 16 - i }));
      pushManualReseedRound(slotMap.round2);
      pushAutoRound([932, 933], slotMap.round2.every(isComplete));
      championshipFeederComplete = isComplete(932) && isComplete(933);
      pushAutoRound([401], championshipFeederComplete);
    } else if (bracketSize === 12) {
      pushRound0(slotMap.round1, (i) => ({ better: i + 5, worse: 12 - i }));
      const round1Complete = slotMap.round1.map(isComplete);
      pushTwelveTeamQuarterfinals(slotMap.quarterfinals, round1Complete);
      pushAutoRound([932, 933], slotMap.quarterfinals.every(isComplete));
      championshipFeederComplete = isComplete(932) && isComplete(933);
      pushAutoRound([401], championshipFeederComplete);
    } else if (bracketSize === 8) {
      pushRound0(slotMap.round1, (i) => ({ better: i + 1, worse: 8 - i }));
      pushAutoRound([932, 933], slotMap.round1.every(isComplete));
      championshipFeederComplete = isComplete(932) && isComplete(933);
      pushAutoRound([401], championshipFeederComplete);
    } else if (bracketSize === 4) {
      pushRound0(slotMap.round1, (i) => ({ better: i + 1, worse: 4 - i })); // [932, 933]
      championshipFeederComplete = slotMap.round1.every(isComplete);
      pushAutoRound([401], championshipFeederComplete);
    } else if (bracketSize === 2) {
      pushRound0(slotMap.round1, () => ({ better: 1, worse: 2 })); // [401]
    }

    const champGame = readGameRaw(401);
    const champion = championshipFeederComplete ? champGame.winner : null;

    // Coach.TeamIndex is a plain int (confirmed via schema - not a
    // reference type like Stadium/BowlGame, so no raw-byte workaround
    // needed here). CONFIRMED via real save testing: TeamIndex is NOT
    // row position - it's a separate numbering system entirely (e.g.
    // North Texas: row=82, but TeamIndex=62). Must compare against the
    // champion team's own TeamIndex field, not its row number.
    let championCoach = null;
    if (champion) {
      const championRow = teamRow(champion);
      if (championRow !== null && championRow !== undefined) {
        const teamTableForCoach = resolveTable(fr, TUI.Team, 'Team');
        await teamTableForCoach.readRecords();
        const championTeamRec = teamTableForCoach.records[championRow];
        let championTeamIndex;
        try { championTeamIndex = championTeamRec['TeamIndex']; } catch { championTeamIndex = undefined; }
        // TeamIndex may be an integer on one table and a string on another
        // depending on schema field type. Convert both to string for comparison.
        const championTeamIndexStr = championTeamIndex !== undefined ? String(championTeamIndex) : undefined;

        if (championTeamIndexStr !== undefined) {
          const coachTable = resolveTable(fr, TUI.Coach, 'Coach');
          await coachTable.readRecords();
          for (let i = 0; i < coachTable.records.length; i++) {
            const rec = coachTable.records[i];
            if (!rec) continue;
            let teamIndex, position;
            try { teamIndex = rec['TeamIndex']; } catch { continue; }
            if (String(teamIndex) !== championTeamIndexStr) continue;
            // CONFIRMED via real save testing: the Coach table holds an
            // entire staff per team (OC, DC, etc.), not just the head
            // coach - all sharing the same TeamIndex. Must filter for
            // Position === 'HeadCoach' specifically, or this grabs
            // whichever staff member happens to be first in the table.
            try { position = rec['Position']; } catch { continue; }
            if (position !== 'HeadCoach') continue;
            let first = '', last = '';
            try { first = rec['FirstName'] || ''; } catch { /* ignore */ }
            try { last = rec['LastName'] || ''; } catch { /* ignore */ }
            championCoach = `${first} ${last}`.trim() || null;
            break;
          }
        }
      }
    }

    // Real in-game season year, confirmed directly against a live save:
    // SeasonYear=4 with the in-game year showing 2030 (2026 + 4). Scans
    // a few records rather than trusting just one, since a single blank
    // slot shouldn't be able to break this - SeasonYear was confirmed
    // identical across every record in a season, so the first valid one
    // found is as good as any other.
    let realSeasonYear = null;
    for (let i = 0; i < seasonTable.records.length; i++) {
      const rec = seasonTable.records[i];
      if (!rec) continue;
      try {
        const rawYear = rec['SeasonYear'];
        if (typeof rawYear === 'number') {
          realSeasonYear = 2026 + rawYear;
          break;
        }
      } catch { /* try the next record */ }
    }

    return { success: true, rounds, champion, championCoach, seasonYear: realSeasonYear };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-round1-status', async (event, { inputPath }) => {
  try {
    const { openSave, readMatchup, readRecordBits, WINNER_BIT, TEAM_TABLE_ID, REGULAR_BOWLS } = await import('./playoffEditorCore.mjs');
    const { rowToName } = await import('./teamLookup.mjs');

    const { unpackedFileContents, recordsStart, recordSize } =
      await openSave(inputPath, path.join(__dirname, 'schemas'));
    const buf = Buffer.from(unpackedFileContents);

    const slotMap = BRACKET_SLOT_MAPS[16];
    const games = [];

    // Seed numbers are fixed by construction, not read from the save: the
    // app always builds Round 1 as seed1v16, seed2v15, ... seed8v9, split
    // 4 into the native First Round slots and 4 into the repurposed bowls,
    // in that exact order (see btnApply in index.html).
    //
    // IMPORTANT: the actual bracket write swaps which team goes into the
    // file's HomeTeam vs AwayTeam field (confirmed in-game: the file's
    // AwayTeam slot is what actually displays/hosts as "home" - the
    // opposite of what the field names suggest). So m.home.row here (byte
    // 8, the file's HomeTeam field) is actually the WORSE seed for this
    // game, and m.away.row (byte 36, AwayTeam) is actually the BETTER
    // seed - opposite of what a naive reading of "home=better seed" would
    // assume. Confirmed via a real report: without this, seed labels came
    // out backwards for every survivor once Round 2 read them back.
    let seedIndex = 0;
    const readOne = (recordIndex, label) => {
      const homeSeed = 16 - seedIndex;
      const awaySeed = seedIndex + 1;
      seedIndex++;

      const m = readMatchup(buf, recordsStart, recordSize, recordIndex);
      if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) {
        games.push({ label, record: recordIndex, home: null, away: null, detectedWinner: null, homeSeed, awaySeed });
        return;
      }
      const recStart = recordsStart + recordIndex * recordSize;
      const recordBuf = buf.subarray(recStart, recStart + recordSize);
      const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
      const homeName = rowToName(m.home.row);
      const awayName = rowToName(m.away.row);
      games.push({
        label, record: recordIndex, home: homeName, away: awayName,
        detectedWinner: winnerBit === 0 ? homeName : awayName,
        homeSeed, awaySeed,
      });
    };

    slotMap.round1Native.forEach((rec, i) => readOne(rec, `First Round game ${i + 1}`));
    slotMap.round1BowlNames.forEach(name => {
      const bowlInfo = REGULAR_BOWLS.find(b => b.name === name);
      readOne(bowlInfo.record, name);
    });

    return { success: true, games };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 12-team's Round 1 (5v12, 6v11, 7v10, 8v9) is all native CFP slots -
// no repurposed-bowl lookup needed, unlike 16-team's version above.
// Real gameplay (confirmed via actual Bowl Week 2 screenshots) showed
// the game's native auto-advance does NOT match the real CFP
// convention Alex wants (8/9's winner playing seed 1, etc.) - it's
// backwards from that. Rather than fight the native wiring, this
// mirrors the 16-team approach entirely: a manual second pass that
// reads the real Round 1 winners and writes the desired Quarterfinal
// pairing directly, overriding whatever the game already auto-
// advanced. Also returns the actual bye occupants read from the save
// itself (records 928-931's real content) rather than trusting
// whatever's still sitting in the UI's seed dropdowns from an earlier
// session - the save is the ground truth for who actually has each bye.
ipcMain.handle('get-round1-status-12', async (event, { inputPath }) => {
  try {
    const { openSave, readMatchup, readRecordBits, WINNER_BIT, TEAM_TABLE_ID } = await import('./playoffEditorCore.mjs');
    const { rowToName } = await import('./teamLookup.mjs');

    const { unpackedFileContents, recordsStart, recordSize } =
      await openSave(inputPath, path.join(__dirname, 'schemas'));
    const buf = Buffer.from(unpackedFileContents);
    const slotMap = BRACKET_SLOT_MAPS[12];

    const games = [];
    slotMap.round1.forEach((rec, i) => {
      const homeSeed = 12 - i; // worse seed - file's HomeTeam field, per the writeGame swap
      const awaySeed = i + 5;  // better seed - file's AwayTeam field
      const label = `Round 1, game ${i + 1} (seed ${awaySeed} vs seed ${homeSeed})`;
      const m = readMatchup(buf, recordsStart, recordSize, rec);
      if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) {
        games.push({ label, record: rec, home: null, away: null, detectedWinner: null, homeSeed, awaySeed });
        return;
      }
      const recStart = recordsStart + rec * recordSize;
      const recordBuf = buf.subarray(recStart, recStart + recordSize);
      const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
      const homeName = rowToName(m.home.row);
      const awayName = rowToName(m.away.row);
      games.push({
        label, record: rec, home: homeName, away: awayName,
        detectedWinner: winnerBit === 0 ? homeName : awayName,
        homeSeed, awaySeed,
      });
    });

    const byes = slotMap.quarterfinals.map((rec, i) => {
      const byeSeed = 4 - i;
      const m = readMatchup(buf, recordsStart, recordSize, rec);
      const name = (m.away.tableId === TEAM_TABLE_ID) ? rowToName(m.away.row) : null;
      return { record: rec, byeSeed, name };
    });

    return { success: true, games, byes };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-cfp-conversion-preference', async () => {
  return readCfpConversionPreference();
});

ipcMain.handle('set-cfp-conversion-preference', async (event, pref) => {
  writeCfpConversionPreference(pref);
  return { success: true };
});

// Checks whether a save currently has the 4 repurposed bowls converted
// to CFP First Round presentation, so the renderer knows whether to
// offer a revert prompt when switching away from a 16-team format.
ipcMain.handle('check-cfp-conversion-state', async (event, { inputPath }) => {
  try {
    const Franchise = (await import('madden-franchise')).default;
    const schemaDirectory = path.join(__dirname, 'schemas');
    const franchise = await Franchise.create(inputPath, {
      schemaDirectory,
      schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
    });
    const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
    const bowlTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
    await bowlTable.readRecords();
    const rec = bowlTable.records[CFP_REPURPOSED_BOWLS[0].row];
    const isConverted = rec['IsPlayoffBowl'] === true;
    return { success: true, isConverted };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('run-edit', async (event, { inputPath, outputPath, config }) => {
  const log = [];
  try {
    const { openSave, openSaveWithTeamTable, readMatchup, writeMatchup, repackSave, REGULAR_BOWLS, readRegularBowlMatchups, TEAM_TABLE_ID } = await import('./playoffEditorCore.mjs');
    const { teamRow, rowToName, lookup } = await import('./teamLookup.mjs');

    // Back up the original save to <savesDir>/Playoff/ before any
    // writes happen, so the user always has a copy to fall back to.
    const safeOutputPath = backupToPlayoffFolder(inputPath, log);
    if (!safeOutputPath) return { success: false, log };
    const resolvedOutputPath = outputPath || safeOutputPath;

    const originalRawBuf = await fsPromises.readFile(inputPath);
    log.push(`Loaded ${inputPath} (${originalRawBuf.length} bytes)`);

    // Captured BEFORE any write happens, in memory - so this stays valid
    // even when inputPath and outputPath are the same file (completely
    // normal - overwriting your own save in place). See
    // verifyNoCollateralStatusChangesFromTable below for why this matters.
    const beforeStatusSnapshot = await snapshotSeasonGameStatus(inputPath, path.join(__dirname, 'schemas'));

    const { unpackedFileContents, season } = await openSaveWithTeamTable(inputPath, path.join(__dirname, 'schemas'));
    const { recordsStart, recordSize, recordCount } = season;
    log.push(`Found SeasonGame table: ${recordCount} records, ${recordSize} bytes each.`);

    const buf = Buffer.from(unpackedFileContents);
    const slotMap = BRACKET_SLOT_MAPS[config.bracketSize];
    if (!slotMap) throw new Error(`Bracket size ${config.bracketSize} is not supported yet.`);

    // Declared here (rather than down where it's first used, right before
    // writeGame's definition) so the dummy-swap cleanup block below can
    // also push into it - see the "if (changed)" fix inside that block.
    const writtenRecords = [];
    let wroteRound2Games = false;
    let wroteRound1Games = false;

    // --- Dummy-team cleanup ---
    // Any team that's part of this playoff bracket but is *also* still
    // sitting in one of the 32 regular (non-CFP) bowl slots needs to be
    // swapped out there for a substitute - otherwise the same team shows
    // up in two Bowl Week games at once. The substitute pool is every real
    // FBS team that (a) isn't itself in the playoff and (b) has no bowl
    // slot anywhere at all, i.e. a team that didn't qualify for a bowl.
    if (config.playoffTeams && config.playoffTeams.length) {
      const playoffRows = new Set(config.playoffTeams.filter(Boolean).map(n => teamRow(n)));

      // Bowl slots we're about to overwrite directly with playoff games this
      // run don't need cleanup - they'll be replaced wholesale below anyway.
      // Also exclude ALL native playoff slot records regardless of bracket
      // size - the dummy-swap must never touch these since they contain real
      // Round 1 results for prior rounds that must stay intact.
      const allPlayoffRecords = new Set([
        924, 925, 926, 927,   // Round 1 (Week 17)
        928, 929, 930, 931,   // Quarterfinals (Week 18)
        932, 933,              // Semifinals (Week 19)
        401,                   // Championship (Week 20)
      ]);
      const repurposedRecords = new Set([
        ...allPlayoffRecords,
        ...(config.bracketSize === 16 ? (slotMap.round1BowlNames || []).map(name => REGULAR_BOWLS.find(b => b.name === name).record) : []),
      ]);

      const bowlMatchups = readRegularBowlMatchups(buf, recordsStart, recordSize);

      const teamsInAnyBowl = new Set();
      bowlMatchups.forEach(b => {
        if (b.homeRow !== null) teamsInAnyBowl.add(b.homeRow);
        if (b.awayRow !== null) teamsInAnyBowl.add(b.awayRow);
      });

      // Worst-first ordering if the renderer sent us its computed ranking
      // (best -> worst team names); otherwise fall back to table order.
      const rankOrder = config.rankingOrder || [];
      const rankIndex = new Map(rankOrder.map((name, i) => [teamRow(name), i]));

      let dummyPool = Object.keys(lookup)
        .filter(name => !name.startsWith('UNKNOWN_PLACEHOLDER'))
        .map(name => teamRow(name))
        .filter(row => !playoffRows.has(row) && !teamsInAnyBowl.has(row));

      if (rankOrder.length) {
        dummyPool.sort((a, b) => (rankIndex.has(b) ? rankIndex.get(b) : -1) - (rankIndex.has(a) ? rankIndex.get(a) : -1));
      }

      let dummyIdx = 0;
      const nextDummy = () => (dummyIdx < dummyPool.length ? dummyPool[dummyIdx++] : null);

      let sawAny = false;
      bowlMatchups.forEach(b => {
        if (repurposedRecords.has(b.record)) return;
        let newHome = b.homeRow, newAway = b.awayRow, changed = false;

        if (b.homeRow !== null && playoffRows.has(b.homeRow)) {
          sawAny = true;
          const dummy = nextDummy();
          if (dummy !== null) {
            log.push(`Dummy swap - ${b.name}: ${rowToName(b.homeRow)} (playoff team) -> ${rowToName(dummy)}`);
            newHome = dummy; changed = true;
          } else {
            log.push(`Dummy swap - ${b.name}: ran out of substitute teams, left ${rowToName(b.homeRow)} in place`);
          }
        }
        if (b.awayRow !== null && playoffRows.has(b.awayRow)) {
          sawAny = true;
          const dummy = nextDummy();
          if (dummy !== null) {
            log.push(`Dummy swap - ${b.name}: ${rowToName(b.awayRow)} (playoff team) -> ${rowToName(dummy)}`);
            newAway = dummy; changed = true;
          } else {
            log.push(`Dummy swap - ${b.name}: ran out of substitute teams, left ${rowToName(b.awayRow)} in place`);
          }
        }
        if (changed) {
          writeMatchup(buf, recordsStart, recordSize, b.record, newHome, newAway);
          // FIX: dummy-swap writes used to bypass writeGame() entirely, so
          // they never got added here - meaning they never got the
          // GameStatus/IsSimmed/HasBeenPublished reset below. That left
          // swapped-in substitute teams (e.g. Southern Miss standing in
          // for North Dakota State) stuck at GameStatus="Unplayed" (the
          // raw schema default) while directly-placed playoff teams (e.g.
          // TCU) correctly got "HomeScheduled". Confirmed root cause of
          // the "wrong opponent shown" bug via diagnose-fulldiff.mjs.
          writtenRecords.push(b.record);
        }
      });
      if (!sawAny) log.push('Dummy swap - no playoff teams were sitting in a non-playoff bowl slot. Nothing to clean up.');
    }

    const writeGame = (recordIndex, game, label) => {
      if (!game || (!game.home && !game.away)) return;
      if (typeof recordIndex !== 'number' || !Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= recordCount) {
        throw new Error(`${label}: target record is invalid (got ${JSON.stringify(recordIndex)}) - this is a bug in how this game's target slot was resolved, not a problem with your picks.`);
      }
      const before = readMatchup(buf, recordsStart, recordSize, recordIndex);
      const beforeHomeValid = before.home.tableId === TEAM_TABLE_ID;
      const beforeAwayValid = before.away.tableId === TEAM_TABLE_ID;
      const beforeHome = beforeHomeValid ? rowToName(before.home.row) : 'TBD';
      const beforeAway = beforeAwayValid ? rowToName(before.away.row) : 'TBD';

      // SAFEGUARD: game.home/game.away being null means "auto-fill from
      // whatever team already won the previous round, already sitting in
      // this slot." If nothing valid is actually sitting there yet, the
      // previous round hasn't been simmed/saved yet in this save file -
      // continuing would write a garbage team reference into the slot.
      // CONFIRMED this can happen in practice: running the tool against a
      // save from before the needed round finished produced exactly this
      // (logged as "TBD -> <team>" on one side, meaning TBD is literally
      // what got written in as the real reference). Abort loudly instead.
      if (!game.home && !beforeHomeValid) {
        throw new Error(`${label}: expected an already-decided winner for the home side, but found none in this save. This usually means the save hasn't been simmed through the previous round yet - sim to the correct week, save, and point the tool at THAT save file.`);
      }
      if (!game.away && !beforeAwayValid) {
        throw new Error(`${label}: expected an already-decided winner for the away side, but found none in this save. This usually means the save hasn't been simmed through the previous round yet - sim to the correct week, save, and point the tool at THAT save file.`);
      }

      const homeRow = game.home ? teamRow(game.home) : before.home.row;
      const awayRow = game.away ? teamRow(game.away) : before.away.row;
      // Confirmed in-game: the team written into the file's AwayTeam field
      // is the one that actually shows as the true home/hosting team on
      // screen - the opposite of what the field names suggest. So our own
      // "home" (the better/higher seed, used everywhere else in the app -
      // seeding, UI, dummy-swap logic, all unchanged) gets written into
      // the file's AwayTeam slot, and vice versa, only at this final byte
      // write. Nothing else about our own seed/ranking logic changes.
      writeMatchup(buf, recordsStart, recordSize, recordIndex, awayRow, homeRow);
      log.push(`${label}: ${beforeHome} -> ${rowToName(homeRow)} vs ${beforeAway} -> ${rowToName(awayRow)}`);
      writtenRecords.push(recordIndex);
    };

    if (config.bracketSize === 16) {
      (config.round1 || []).slice(0, 4).forEach((game, i) => {
        if (game && (game.home || game.away)) wroteRound1Games = true;
        writeGame(slotMap.round1Native[i], game, `Round 1 (First Round game ${i + 1})`);
      });
      (config.round1 || []).slice(4, 8).forEach((game, i) => {
        if (game && (game.home || game.away)) wroteRound1Games = true;
        const bowlName = slotMap.round1BowlNames[i];
        const bowlInfo = REGULAR_BOWLS.find(b => b.name === bowlName);
        writeGame(bowlInfo.record, game, `Round 1 (${bowlName})`);
      });
      (config.round2 || []).forEach((game, i) => {
        if (game && (game.home || game.away)) wroteRound2Games = true;
        writeGame(slotMap.round2[i], game, `Round 2 (Quarterfinal ${i + 1})`);
      });
    } else if (config.bracketSize === 12) {
      // Round 1: seeds 5-12 (4 games, higher seed hosts)
      (config.round1 || []).forEach((game, i) => {
        writeGame(slotMap.round1[i], game, `Round 1, game ${i + 1} (seed ${i + 5} vs seed ${12 - i})`);
      });
      // Quarterfinals: seeds 1-4 written as home team with TBD away
      // (game fills in the Round 1 winner automatically after the game
      // processes the first-round results). config.quarterfinals[i] is
      // sent in DESCENDING seed order (seed 4 first) by the UI, since
      // that's what lands each bye next to its correct Round 1 game
      // (924<->928, ... 927<->931) per the confirmed real seeding: 8/9
      // plays seed 1, 7/10 plays seed 2, 6/11 plays seed 3, 5/12 plays
      // seed 4. So the label here says seed (4-i), not seed (i+1).
      (config.quarterfinals || []).forEach((game, i) => {
        writeGame(slotMap.quarterfinals[i], game, `Quarterfinal bye, seed ${4 - i} (awaits winner of game ${i + 1})`);
      });
    } else {
      (config.round1 || []).forEach((game, i) => {
        writeGame(slotMap.round1[i], game, `Round 1, game ${i + 1}`);
      });
    }

    // User-customized non-playoff bowl matchups - same writeGame
    // mechanism as every bracket game above, so it inherits the exact
    // same swap convention, logging, and "already decided" safety
    // check. Written last, after dummy-swap has already run, so a
    // custom pick here is never immediately swapped back out. Both
    // home and away are required (no "auto-fill from previous round"
    // concept applies to a bowl outside the bracket).
    (config.customBowlMatchups || []).forEach(({ record, name, home, away }) => {
      if (!home || !away) return;
      writeGame(record, { home, away }, `Custom bowl (${name})`);
    });

    // NY6 leftover slot team assignments - writeGame handles these the
    // same way as custom bowl matchups. Bowl-identity/branding changes
    // were investigated extensively but found to be inseparable from
    // CFP presentation elements (broadcast overlay, uniform patch, field
    // markings) - no clean path exists to set real bowl branding without
    // also triggering those overlays on these specific native slots.
    // Teams only; presentation stays native.
    (config.ny6BowlAssignments || []).forEach(({ record, home, away }) => {
      if (!home || !away) return;
      writeGame(record, { home, away }, `NY6 leftover slot ${record}`);
    });

    const finalBuf = repackSave(originalRawBuf, buf);
    await fsPromises.writeFile(resolvedOutputPath, finalBuf);
    log.push(`Wrote ${resolvedOutputPath} (${finalBuf.length} bytes). Done!`);

    // Safety check, not a fix: confirmed real bug where repackSave can
    // occasionally produce a file that findZlibStart later misreads on
    // re-open (a coincidental false-positive zlib header match earlier in
    // the file than the real one - see SESSION_FINDINGS.md). This doesn't
    // solve that; it just makes sure we never silently hand back a broken
    // file. Immediately try to re-open what we just wrote, before doing
    // anything else with it.
    try {
      await openSave(resolvedOutputPath, path.join(__dirname, 'schemas'));
    } catch (verifyErr) {
      log.push(`*** VERIFICATION FAILED - the file we just wrote could not be re-opened (${verifyErr.message}). ***`);
      log.push('*** DO NOT use this output file. This is a known, unresolved bug in the save-writing step itself - see the Discord. ***');
      return { success: false, log };
    }

    // Fix for a confirmed beta bug: a bracket slot can carry a leftover
    // GameStatus/IsSimmed state from whatever the game's own default
    // matchup was (e.g. "HomeWon"/IsSimmed=true - already decided, nothing
    // left to play) even before we touch it. We only ever wrote the team
    // references, never these status fields, so a team we insert into an
    // already-"finished" slot inherited that finished status and vanished
    // from the schedule as a playable game - showing as a bye. Confirmed
    // via a real before/after save comparison from a beta tester. Reset
    // exactly these three fields, and only on records we actually wrote
    // to - nothing else, learning from the bowl-rebranding incident where
    // touching extra fields caused visual corruption. Not yet confirmed
    // in-game that this specific fix resolves the bye - needs real
    // testing before trusting broadly.
    // Computed here, before deciding whether to even open the schema
    // library a second time - a pure Round 2 call has nothing to
    // rank-sync, so it should skip the re-open entirely, not just skip
    // the write inside it. Re-opening the file we just wrote carries a
    // real, confirmed corruption risk (see SESSION_FINDINGS.md) - no
    // reason to take that risk when there's nothing to actually change.
    const isSecondPassOf16 = config.bracketSize === 16 && wroteRound2Games && !wroteRound1Games;
    if (isSecondPassOf16) {
      log.push('Rank sync - skipped entirely, including the file re-open (16-team Round 2 reseed only changes pairings, not seed numbers - ranks were already written correctly in Pass 1).');
    }

    if (writtenRecords.length && !isSecondPassOf16) {
      try {
        const Franchise = (await import('madden-franchise')).default;
        const franchise2 = await Franchise.create(resolvedOutputPath, {
          schemaDirectory: path.join(__dirname, 'schemas'),
          autoParse: true,
          schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(__dirname, 'schemas', '486_1.gz') },
        });
        const { resolveTable, TABLE_UNIQUE_IDS: TUI } = await import('./playoffEditorCore.mjs');
        const seasonTable2 = resolveTable(franchise2, TUI.SeasonGame, 'SeasonGame');
        await seasonTable2.readRecords();

        if (config.seedAssignments && config.seedAssignments.length) {
          const seedAssignments = config.seedAssignments
            .filter(a => a && a.team)
            .map(a => ({ row: teamRow(a.team), seed: a.seed }));

          if (seedAssignments.length) {
            const teamTable2 = resolveTable(franchise2, TUI.Team, 'Team');
            await teamTable2.readRecords();
            await syncPollRanks(teamTable2, seedAssignments, config.rankingOrder, teamRow, rowToName, log);
          } else {
            log.push('Rank sync - seedAssignments was present but empty after filtering, skipped.');
          }
        } else {
          log.push('Rank sync - skipped (no seedAssignments provided by the renderer - update index.html to the version that sends config.seedAssignments).');
        }

        await franchise2.save();
        log.push('Rank sync saved.');

        // Verification reuses seasonTable2 from franchise2 (already open
        // and read above) - no extra Franchise.create needed here.
        try {
          const allowedRecords = getAllowedRecordsForThisRun(config, slotMap, REGULAR_BOWLS);
          const violations = verifyNoCollateralStatusChangesFromTable(beforeStatusSnapshot, seasonTable2, allowedRecords);
          if (violations.length) {
            log.push('');
            log.push('*** VERIFICATION FAILED - collateral damage detected outside this run\'s allowed records: ***');
            violations.forEach(v => log.push('  ' + v));
            log.push('*** DO NOT use this output file. Something touched records this bracket size should never have written to. ***');
            return { success: false, log };
          }
          log.push(`Verified: no changes outside this run's allowed records (${[...allowedRecords].sort((a, b) => a - b).join(', ')}).`);
        } catch (verifyErr) {
          log.push(`WARNING - could not run the collateral-damage verification check: ${verifyErr.message}. The output file was written but hasn't been double-checked for out-of-scope changes.`);
        }

      } catch (err) {
        log.push(`WARNING - rank sync failed, but the bracket itself was already written successfully: ${err.message}`);
      }
    }

    // Verification fallback when rank sync was skipped (no writtenRecords)
    // - only needed if we didn't go through the franchise2 path above.
    if (!writtenRecords.length) {
      try {
        const allowedRecords = getAllowedRecordsForThisRun(config, slotMap, REGULAR_BOWLS);
        const violations = await verifyNoCollateralStatusChanges(beforeStatusSnapshot, resolvedOutputPath, path.join(__dirname, 'schemas'), allowedRecords);
        if (violations.length) {
          log.push('');
          log.push('*** VERIFICATION FAILED - collateral damage detected outside this run\'s allowed records: ***');
          violations.forEach(v => log.push('  ' + v));
          log.push('*** DO NOT use this output file. Something touched records this bracket size should never have written to. ***');
          return { success: false, log };
        }
        log.push(`Verified: no changes outside this run's allowed records (${[...allowedRecords].sort((a, b) => a - b).join(', ')}).`);
      } catch (err) {
        log.push(`WARNING - could not run the collateral-damage verification check: ${err.message}. The output file was written but hasn't been double-checked for out-of-scope changes.`);
      }
    }

    // --- CFP First Round presentation convert/revert ---
    // Confirmed working end-to-end via live in-game testing (stadium,
    // playoff status, field markings, announcer commentary, logo, and
    // jersey patch all verified correct). Convert only runs on the
    // Round 1-writing pass of a 16-team bracket (not the Round 2
    // reseed pass - the 4 bowls only need this done once). Revert only
    // runs when a different bracket size is explicitly told to.
    if (config.bracketSize === 16 && wroteRound1Games && config.convertToPlayoffPresentation) {
      log.push('');
      log.push('Converting the 4 repurposed bowls to CFP First Round presentation:');
      try {
        await applyCfpConversion(resolvedOutputPath, path.join(__dirname, 'schemas'), log);
      } catch (err) {
        log.push(`  WARNING - CFP presentation conversion failed: ${err.message}. The bracket itself was still written correctly - this only affects the extra presentation polish.`);
      }
    } else if (config.bracketSize !== 16 && config.revertPlayoffPresentation) {
      log.push('');
      log.push('Reverting the 4 repurposed bowls back to their original presentation:');
      try {
        await revertCfpConversion(resolvedOutputPath, path.join(__dirname, 'schemas'), log);
      } catch (err) {
        log.push(`  WARNING - CFP presentation revert failed: ${err.message}.`);
      }
    }

    // Championship location override - independent of bracket size and
    // of who actually ends up playing there, since it's just a stadium
    // choice on a fixed record (401). Runs whenever the renderer sends
    // a choice, regardless of which bracket size is being built.
    if (config.championshipStadiumTeam) {
      log.push('');
      log.push('Setting the Championship location:');
      try {
        await applyChampionshipStadiumOverride(resolvedOutputPath, path.join(__dirname, 'schemas'), config.championshipStadiumTeam, log);
      } catch (err) {
        log.push(`  WARNING - Championship location override failed: ${err.message}.`);
      }
    }

    // Always runs, every Apply - corrects any player whose season-stat
    // team reference has drifted from their current roster, treating
    // roster as ground truth. See correctSeasonStatsToMatchRoster's own
    // comment for the important caveat: this fixes the symptom every
    // time, but whether this tool's own write path is the actual root
    // cause is still an open, untested question.
    log.push('');
    log.push('Checking player season-stat team references against current rosters:');
    try {
      await correctSeasonStatsToMatchRoster(resolvedOutputPath, path.join(__dirname, 'schemas'), log);
    } catch (err) {
      log.push(`  WARNING - season-stat correction failed: ${err.message}. The bracket itself was still written correctly.`);
    }

    return { success: true, log };
  } catch (err) {
    log.push(`ERROR: ${err.message}`);
    return { success: false, log };
  }
});
