// main.cjs - Electron main process.
// Note: uses .cjs extension so it runs as CommonJS even though the rest of
// the project is ESM ("type": "module" in package.json). Dynamic import()
// is used to pull in the ESM core logic - this works fine from CommonJS.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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
async function applyStadiumFix(outputPath, schemaDirectory, log) {
  const { openSave, repackSave, REGULAR_BOWLS, TABLE_UNIQUE_IDS } = await import('./playoffEditorCore.mjs');
  const Franchise = (await import('madden-franchise')).default;
  const { rowToName } = await import('./teamLookup.mjs');

  const franchise = await Franchise.create(outputPath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
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
  function findTeamRow(teamName) {
    for (let i = 0; i < teamTable.records.length; i++) {
      let name;
      try { name = rowToName(i); } catch { continue; }
      if (name === teamName) return i;
    }
    return null;
  }

  const { unpackedFileContents, recordsStart, recordSize } = await openSave(outputPath, schemaDirectory);
  const buf = Buffer.from(unpackedFileContents);
  const teamTableOffset = teamTable.offset + teamTable.header.headerSize;
  const teamRecordSize = teamTable.header.record1Size;

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
    const teamRow = findTeamRow(hostTeam);
    if (teamRow === null) { log.push(`  CFP presentation: could not find ${hostTeam} in Team table - stadium not changed.`); continue; }
    const teamRec = teamTable.records[teamRow];
    const stadiumField = getFieldObj(teamRec, 'Stadium');
    if (!stadiumField || !stadiumField.value || /^0+$/.test(stadiumField.value)) { log.push(`  CFP presentation: ${hostTeam}'s own Stadium field is empty - stadium not changed.`); continue; }
    const stadiumOffsetInfo = teamRec._offsetTable?.find(f => f.name === 'Stadium');
    if (!stadiumOffsetInfo) continue;
    const byteOffset = stadiumOffsetInfo.offset / 8;
    const sourceOffset = teamTableOffset + teamRow * teamRecordSize + byteOffset;
    const targetOffset = recordsStart + seasonRecordIndex * recordSize + 4; // confirmed: Stadium is byte 4, 4 bytes, on SeasonGame
    buf.copy(buf, targetOffset, sourceOffset, sourceOffset + 4);
    fixedCount++;
    log.push(`  CFP presentation: ${bowl.name} now uses ${hostTeam}'s real home stadium.`);
  }

  if (fixedCount > 0) {
    const originalRawBuf = fs.readFileSync(outputPath);
    const finalBuf = repackSave(originalRawBuf, buf);
    fs.writeFileSync(outputPath, finalBuf);
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
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
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

async function applyCfpConversion(outputPath, schemaDirectory, log) {
  await applyStadiumFix(outputPath, schemaDirectory, log);
  await writeBowlGamePresentation(outputPath, schemaDirectory, 'convert', log);
}
async function revertCfpConversion(outputPath, schemaDirectory, log) {
  await writeBowlGamePresentation(outputPath, schemaDirectory, 'revert', log);
}

// Fixes a PERSISTENT, unrelated issue - some external tool/mod (not
// ours) mass-relabeled 13 real, ordinary bowl games to "CFP First
// Round" text at some point in this dynasty's history, and since the
// underlying corruption is baked into this save lineage rather than a
// one-time event, it keeps resurfacing on fresh saves rather than
// staying fixed. Runs on EVERY Apply, regardless of bracket size -
// unlike the 4 repurposed bowls (5/18/25/37), which follow their own
// separate convert/revert logic tied to the 16-team format specifically.
// Confirmed via dump-all-bowlgame-flags.mjs: exactly these 13 rows,
// consistently. The IsPlayoffBowl safety check (same as the standalone
// fix-bowl-names-v2.mjs) means this can never accidentally revert an
// actual playoff game even if the row numbers ever shifted.
const UNRELATED_MISLABELED_BOWLS = {
  6: 'Citrus Bowl',
  19: "Duke's Mayo Bowl",
  21: 'Famous Idaho Potato Bowl',
  23: 'First Responder Bowl',
  24: 'Frisco Bowl',
  26: 'Gator Bowl',
  30: 'Independence Bowl',
  34: 'Music City Bowl',
  35: 'Myrtle Beach Bowl',
  36: 'New Mexico Bowl',
  40: 'Reliaquest Bowl',
  42: 'Sun Bowl',
  44: 'Xbox Bowl',
};
async function restoreUnrelatedMislabeledBowls(outputPath, schemaDirectory, log) {
  const Franchise = (await import('madden-franchise')).default;
  const franchise = await Franchise.create(outputPath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
  });
  const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
  const bowlTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await bowlTable.readRecords();

  let fixedCount = 0;
  for (const [indexStr, correctName] of Object.entries(UNRELATED_MISLABELED_BOWLS)) {
    const index = parseInt(indexStr, 10);
    const rec = bowlTable.records[index];
    if (!rec) continue;
    let isPlayoff = false;
    try { isPlayoff = rec['IsPlayoffBowl'] === true; } catch { /* ignore */ }
    if (isPlayoff) continue; // never touch a real playoff-flagged row
    let currentName = null;
    try { currentName = rec['Name']; } catch { /* ignore */ }
    if (currentName === correctName) continue; // already correct, nothing to do
    rec['Name'] = correctName;
    fixedCount++;
  }
  if (fixedCount > 0) {
    await franchise.save(outputPath);
    log.push(`  Restored ${fixedCount} unrelated bowl name(s) that had been mislabeled "CFP First Round" (not caused by this tool - see README).`);
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
    const { openSave, findConferenceChampionsByStandings } = await import('./playoffEditorCore.mjs');
    const { computeFullBCSRankings } = await import('./bcsRankingFull.mjs');
    const { loadTeamConference } = await import('./teamConference.mjs');
    const { TEAM_CONFERENCE } = loadTeamConference();

    const { unpackedFileContents, recordsStart, recordSize, recordCount } =
      await openSave(inputPath, path.join(__dirname, 'schemas'));
    const buf = Buffer.from(unpackedFileContents);

    const { confChampions: champResults, unresolved } = await findConferenceChampionsByStandings(
      buf, recordsStart, recordSize, recordCount, TEAM_CONFERENCE, inputPath, path.join(__dirname, 'schemas')
    );
    const confChampions = {};
    for (const [conf, info] of Object.entries(champResults)) {
      confChampions[conf] = info.winner;
    }
    const unmatchedConfGames = unresolved.map(u => ({ home: u.conf, away: '', winner: `unresolved: ${u.reason}` }));

    const rankings = computeFullBCSRankings(buf, recordsStart, recordSize, recordCount, confChampions, { ...(options || {}), teamConference: TEAM_CONFERENCE });
    return { success: true, rankings, unmatchedConfGames };
  } catch (err) {
    return { success: false, error: err.message };
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

async function snapshotSeasonGameStatus(inputPath, schemaDirectory) {
  const Franchise = (await import('madden-franchise')).default;
  const { resolveTable, TABLE_UNIQUE_IDS: TUI } = await import('./playoffEditorCore.mjs');
  const fr = await Franchise.create(inputPath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
  });
  const t = resolveTable(fr, TUI.SeasonGame, 'SeasonGame');
  await t.readRecords();
  const snapshot = [];
  for (let i = 0; i < t.records.length; i++) {
    const rec = t.records[i];
    if (!rec) { snapshot.push(null); continue; }
    let status, isSimmed, published;
    try { status = rec['GameStatus']; } catch { status = undefined; }
    try { isSimmed = rec['IsSimmed']; } catch { isSimmed = undefined; }
    try { published = rec['HasBeenPublished']; } catch { published = undefined; }
    snapshot.push({ status, isSimmed, published });
  }
  return snapshot;
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
async function verifyNoCollateralStatusChanges(beforeSnapshot, outputPath, schemaDirectory, allowedRecords) {
  const Franchise = (await import('madden-franchise')).default;
  const { resolveTable, TABLE_UNIQUE_IDS: TUI } = await import('./playoffEditorCore.mjs');

  const fr = await Franchise.create(outputPath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
  });
  const afterTable = resolveTable(fr, TUI.SeasonGame, 'SeasonGame');
  await afterTable.readRecords();

  const violations = [];
  const count = Math.min(beforeSnapshot.length, afterTable.records.length);
  for (let i = 0; i < count; i++) {
    if (allowedRecords.has(i)) continue;
    const before = beforeSnapshot[i];
    const after = afterTable.records[i];
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
        major: 472,
        minor: 0,
        gameYear: 27,
        path: path.join(__dirname, 'schemas', '472_0.gz'),
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

ipcMain.handle('save-bracket-to-history', async (event, { year, bracketSize, rounds, champion }) => {
  try {
    if (!year || !Number.isInteger(year)) {
      return { success: false, error: 'A valid year is required.' };
    }
    const entries = readBracketHistoryFile();
    const existingIndex = entries.findIndex(e => e.year === year);
    const entry = { year, bracketSize, rounds, champion, savedAt: new Date().toISOString() };
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
      schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(__dirname, 'schemas', '472_0.gz') },
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
    const { rowToName } = await import('./teamLookup.mjs');
    const Franchise = (await import('madden-franchise')).default;

    const { unpackedFileContents, recordsStart, recordSize } =
      await openSave(inputPath, path.join(__dirname, 'schemas'));
    const buf = Buffer.from(unpackedFileContents);

    const fr = await Franchise.create(inputPath, {
      schemaDirectory: path.join(__dirname, 'schemas'),
      schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(__dirname, 'schemas', '472_0.gz') },
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

    return { success: true, rounds, champion, seasonYear: realSeasonYear };
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
      schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
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

    const originalRawBuf = fs.readFileSync(inputPath);
    log.push(`Loaded ${inputPath} (${originalRawBuf.length} bytes)`);

    // Captured BEFORE any write happens, in memory - so this stays valid
    // even when inputPath and outputPath are the same file (completely
    // normal - overwriting your own save in place). See
    // verifyNoCollateralStatusChanges below for why this matters.
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

    const finalBuf = repackSave(originalRawBuf, buf);
    fs.writeFileSync(outputPath, finalBuf);
    log.push(`Wrote ${outputPath} (${finalBuf.length} bytes). Done!`);

    // Safety check, not a fix: confirmed real bug where repackSave can
    // occasionally produce a file that findZlibStart later misreads on
    // re-open (a coincidental false-positive zlib header match earlier in
    // the file than the real one - see SESSION_FINDINGS.md). This doesn't
    // solve that; it just makes sure we never silently hand back a broken
    // file. Immediately try to re-open what we just wrote, before doing
    // anything else with it.
    try {
      await openSave(outputPath, path.join(__dirname, 'schemas'));
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
        const franchise2 = await Franchise.create(outputPath, {
          schemaDirectory: path.join(__dirname, 'schemas'),
          autoParse: true,
          schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(__dirname, 'schemas', '472_0.gz') },
        });
        const { resolveTable, TABLE_UNIQUE_IDS: TUI } = await import('./playoffEditorCore.mjs');
        const seasonTable2 = resolveTable(franchise2, TUI.SeasonGame, 'SeasonGame');
        await seasonTable2.readRecords();

        // CONFIRMED BUG, removed: this used to force GameStatus/IsSimmed/
        // HasBeenPublished back to an unplayed state on every record we
        // write into. Testing proved this is what breaks live-play result
        // commitment - a game reset this way gets stuck showing as
        // "still needs to be played" even after being fully played to
        // completion, regardless of anything else touched in the same
        // pass (isolated via testing: team-only writes work and hold up
        // through both simming and live play; status-only writes break
        // it on their own, with zero team change involved). See
        // SESSION_FINDINGS.md.
        //
        // We no longer touch these fields at all. A record's leftover
        // native GameStatus/score is inherited from whatever it last
        // held - if the game gets auto-simmed, that leftover carries
        // through (cosmetic only); if the user plays it live, their
        // played result correctly overrides it, same as any other game
        // in the game that was never touched by this tool.

        // Request ID regeneration removed - it was built for the
        // wrong-opponent display bug, which testing later proved is a
        // pure EA-side in-memory cache with zero footprint in the save
        // file at all. No amount of save editing could ever have fixed
        // it, so this never showed a confirmed benefit. Removed for
        // simplicity now that the tool only does team swap + rank sync.

        // --- Poll-rank sync (CFP/Coaches/Media + TeamRank) ---
        // Makes the in-game Top 25 display match the tool's own seeding
        // instead of the game's separately-simulated committee order.
        // Confirmed working via test-sync-poll-ranks-v2.mjs (survives
        // repack + a full sim week, no snap-back observed).
        //
        // CONFIRMED BUG (16-team test, real bracket): originally built
        // seed numbers by filtering config.rankingOrder down to
        // config.playoffTeams and numbering sequentially. That silently
        // breaks whenever an autobid team's assigned seed differs from
        // its position in rankingOrder (autoFillEmptySeeds in index.html
        // pulls autobid teams OUT of the ranking pool before filling
        // At-Large seeds, so their bracket seed and their rank position
        // are two different things by design). UNLV and Virginia were
        // seeded 5 and 6 but ranked ~10th and ~15th - every team ranked
        // between those positions drifted by however many autobid slots
        // sat above it. Fixed by using config.seedAssignments instead:
        // the renderer now sends the actual seed_i dropdown values
        // directly, which is the literal source of truth the "Round 1
        // Matchups" panel itself is built from - no reconstruction, no
        // room for the two data sources to disagree.
        if (config.seedAssignments && config.seedAssignments.length) {
          const seedAssignments = config.seedAssignments
            .filter(a => a && a.team)
            .map(a => ({ row: teamRow(a.team), seed: a.seed }));

          if (seedAssignments.length) {
            const teamTable2 = resolveTable(franchise2, TUI.Team, 'Team');
            await teamTable2.readRecords();
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

            // Fill ranks past the bracket cutoff (17-25 for a 16-team
            // bracket, generalizing to "up to 25 total" for any size)
            // with the next-best teams by our own ranking engine, then
            // EXPLICITLY zero out (NR - confirmed via the schema that 0
            // is the real "not ranked" sentinel, same as every actual
            // AP/CFP-style poll) every other team in the Team table.
            // This is the actual fix for the duplicate-rank-number bug
            // (e.g. two teams both showing "15") - the old code above
            // only ever touched bracket teams and left everyone else's
            // stale native rank in place, which is exactly what collided
            // with our forced numbers. Explicitly touching every team,
            // not just the ones we care about, is what actually
            // eliminates that.
            if (config.rankingOrder && config.rankingOrder.length) {
              let nextRank = seedAssignments.length + 1;
              for (const teamName of config.rankingOrder) {
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
                log.push(`Rank sync - ${teamName}: rank -> ${nextRank} (next-best outside the bracket).`);
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
          } else {
            log.push('Rank sync - seedAssignments was present but empty after filtering, skipped.');
          }
        } else {
          log.push('Rank sync - skipped (no seedAssignments provided by the renderer - update index.html to the version that sends config.seedAssignments).');
        }

        await franchise2.save();
        log.push('Rank sync saved.');
      } catch (err) {
        log.push(`WARNING - rank sync failed, but the bracket itself was already written successfully: ${err.message}`);
      }
    }

    // --- Verify no collateral damage outside this run's own rules ---
    // Originally added after a CONFIRMED BUG where an 8-team run (should
    // only ever touch 928-931) reverted already-played Week 17 results
    // (924-927) back to unplayed - traced to the GameStatus-reset pass
    // that used to run here (now removed entirely, see above). Kept as
    // a general safety net even without that pass: still re-opens the
    // original input and the final output and directly compares every
    // record's play-status fields. Anything outside this run's allowed set
    // that changed anyway is
    // flagged as a hard failure - this is the "each bracket bound to its
    // own rules" enforcement, checked after the fact instead of assumed.
    try {
      const allowedRecords = getAllowedRecordsForThisRun(config, slotMap, REGULAR_BOWLS);
      const violations = await verifyNoCollateralStatusChanges(beforeStatusSnapshot, outputPath, path.join(__dirname, 'schemas'), allowedRecords);
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
        await applyCfpConversion(outputPath, path.join(__dirname, 'schemas'), log);
      } catch (err) {
        log.push(`  WARNING - CFP presentation conversion failed: ${err.message}. The bracket itself was still written correctly - this only affects the extra presentation polish.`);
      }
    } else if (config.bracketSize !== 16 && config.revertPlayoffPresentation) {
      log.push('');
      log.push('Reverting the 4 repurposed bowls back to their original presentation:');
      try {
        await revertCfpConversion(outputPath, path.join(__dirname, 'schemas'), log);
      } catch (err) {
        log.push(`  WARNING - CFP presentation revert failed: ${err.message}.`);
      }
    }

    // Always runs, every Apply, every bracket size - independent of
    // the above. Fixes the persistent unrelated mislabeling issue on
    // 13 other bowl games (not the 4 repurposed ones, which are
    // handled above according to bracket size/user choice).
    try {
      await restoreUnrelatedMislabeledBowls(outputPath, path.join(__dirname, 'schemas'), log);
    } catch (err) {
      log.push(`  WARNING - could not check/restore unrelated bowl names: ${err.message}.`);
    }

    return { success: true, log };
  } catch (err) {
    log.push(`ERROR: ${err.message}`);
    return { success: false, log };
  }
});
