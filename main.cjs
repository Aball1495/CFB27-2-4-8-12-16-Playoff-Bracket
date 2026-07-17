// main.cjs - Electron main process.
// Note: uses .cjs extension so it runs as CommonJS even though the rest of
// the project is ESM ("type": "module" in package.json). Dynamic import()
// is used to pull in the ESM core logic - this works fine from CommonJS.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

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

ipcMain.handle('run-edit', async (event, { inputPath, outputPath, config }) => {
  const log = [];
  try {
    const { openSaveWithTeamTable, readMatchup, writeMatchup, repackSave, REGULAR_BOWLS, readRegularBowlMatchups, TEAM_TABLE_ID } = await import('./playoffEditorCore.mjs');
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
      const beforeHome = before.home.tableId === TEAM_TABLE_ID ? rowToName(before.home.row) : 'TBD';
      const beforeAway = before.away.tableId === TEAM_TABLE_ID ? rowToName(before.away.row) : 'TBD';
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
        writeGame(slotMap.round1Native[i], game, `Round 1 (First Round game ${i + 1})`);
      });
      (config.round1 || []).slice(4, 8).forEach((game, i) => {
        const bowlName = slotMap.round1BowlNames[i];
        const bowlInfo = REGULAR_BOWLS.find(b => b.name === bowlName);
        writeGame(bowlInfo.record, game, `Round 1 (${bowlName})`);
      });
      (config.round2 || []).forEach((game, i) => {
        writeGame(slotMap.round2[i], game, `Round 2 (Quarterfinal ${i + 1})`);
      });
    } else if (config.bracketSize === 12) {
      // Round 1: seeds 5-12 (4 games, higher seed hosts)
      (config.round1 || []).forEach((game, i) => {
        writeGame(slotMap.round1[i], game, `Round 1, game ${i + 1} (seed ${i + 5} vs seed ${12 - i})`);
      });
      // Quarterfinals: seeds 1-4 written as home team with TBD away
      // (game fills in the Round 1 winner automatically after the game
      // processes the first-round results).
      (config.quarterfinals || []).forEach((game, i) => {
        writeGame(slotMap.quarterfinals[i], game, `Quarterfinal bye, seed ${i + 1}`);
      });
    } else {
      (config.round1 || []).forEach((game, i) => {
        writeGame(slotMap.round1[i], game, `Round 1, game ${i + 1}`);
      });
    }

    const finalBuf = repackSave(originalRawBuf, buf);
    fs.writeFileSync(outputPath, finalBuf);
    log.push(`Wrote ${outputPath} (${finalBuf.length} bytes). Done!`);

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
    if (writtenRecords.length) {
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

        // Only reset GameStatus on the actual target playoff slots for this
        // bracket size — NOT on dummy-swap records from prior weeks.
        // Dummy-swapped records may be in weeks that have already been played
        // (e.g. Week 18 for a 4-team bracket), and resetting their GameStatus
        // to HomeScheduled causes the game to replay those weeks.
        const targetSlots = new Set([
          ...(slotMap.round1 || []),
          ...(slotMap.round1Native || []),
          ...(slotMap.quarterfinals || []),
          ...(slotMap.round2 || []),
          ...(config.bracketSize === 16
            ? (slotMap.round1BowlNames || []).map(name => REGULAR_BOWLS.find(b => b.name === name)?.record).filter(Boolean)
            : []),
        ]);

        for (const recordIndex of writtenRecords) {
          if (!targetSlots.has(recordIndex)) continue; // skip dummy-swap records
          const rec = seasonTable2.records[recordIndex];
          if (!rec) continue;
          try {
            rec.GameStatus = 'HomeScheduled';
            rec.IsSimmed = false;
            rec.HasBeenPublished = false;
            log.push(`Record ${recordIndex}: reset GameStatus/IsSimmed/HasBeenPublished to an unplayed state.`);
          } catch (fieldErr) {
            log.push(`Record ${recordIndex}: could not reset game-status fields - ${fieldErr.message}`);
          }
        }

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
        //
        // Skipped on the 16-team SECOND pass: reseeding only changes who
        // plays whom in the Quarterfinal, not each team's underlying seed
        // number - ranks were already written correctly in Pass 1 and
        // don't need touching again. Detected by config.round1 being
        // empty/absent (Pass 1 always populates it; Pass 2 only sends
        // config.round2).
        const isSecondPassOf16 = config.bracketSize === 16 && !(config.round1 && config.round1.length);

        if (!isSecondPassOf16 && config.seedAssignments && config.seedAssignments.length) {
          const seedAssignments = config.seedAssignments
            .filter(a => a && a.team)
            .map(a => ({ row: teamRow(a.team), seed: a.seed }));

          if (seedAssignments.length) {
            const teamTable2 = resolveTable(franchise2, TUI.Team, 'Team');
            await teamTable2.readRecords();
            const POLLS = ['CFPPoll', 'CoachesPoll', 'MediaPoll'];
            for (const { row, seed: s } of seedAssignments) {
              const rec = teamTable2.records[row];
              if (!rec) { log.push(`Rank sync - row ${row}: no record found, skipped.`); continue; }
              const before = rec['CFPPoll_CurrentRank'];
              for (const poll of POLLS) {
                rec[`${poll}_LastWeeksRank`] = rec[`${poll}_CurrentRank`];
                rec[`${poll}_CurrentRank`] = s;
              }
              rec['TeamRank'] = s;
              log.push(`Rank sync - ${rowToName(row)}: rank -> ${s} (was ${before}).`);
            }
          } else {
            log.push('Rank sync - seedAssignments was present but empty after filtering, skipped.');
          }
        } else if (isSecondPassOf16) {
          log.push('Rank sync - skipped (16-team Round 2 reseed only changes pairings, not seed numbers).');
        } else {
          log.push('Rank sync - skipped (no seedAssignments provided by the renderer - update index.html to the version that sends config.seedAssignments).');
        }

        await franchise2.save();
        log.push('Game-status reset and rank sync saved.');
      } catch (err) {
        log.push(`WARNING - game-status reset/rank sync failed, but the bracket itself was already written successfully: ${err.message}`);
      }
    }

    // --- Verify no collateral damage outside this run's own rules ---
    // CONFIRMED BUG: an 8-team run (should only ever touch 928-931) was
    // observed reverting already-played Week 17 results (924-927) back
    // to unplayed. The explicit GameStatus-reset loop above was already
    // correctly scoped via targetSlots, which means the disturbance was
    // happening some other way - most likely a side effect of the second
    // Franchise.create()/save() pass re-serializing the entire SeasonGame
    // table, not anything this code explicitly set. Rather than trust
    // that scoping again, this re-opens the original input and the final
    // output and directly compares every record's play-status fields.
    // Anything outside this run's allowed set that changed anyway is
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

    return { success: true, log };
  } catch (err) {
    log.push(`ERROR: ${err.message}`);
    return { success: false, log };
  }
});
