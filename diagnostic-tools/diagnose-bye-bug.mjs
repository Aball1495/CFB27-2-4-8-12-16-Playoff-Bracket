#!/usr/bin/env node
/**
 * Diagnostic: investigating the "shows up as a bye" bug reported by beta
 * testers on 8/16-team brackets. Checks two hypotheses:
 *
 * 1. SeasonGame records might carry HomeScheduled/AwayScheduled/
 *    IsVisitScheduled/VisitScheduled flags that our writes never touch -
 *    if these are left in a stale "not scheduled" state from before our
 *    edit, that could explain a bye showing even with valid team refs
 *    written into HomeTeam/AwayTeam.
 * 2. There might be a SEPARATE per-team/per-week schedule lookup table
 *    (something like SeasonScheduleManager) that the schedule screen
 *    actually reads from, independent of the SeasonGame records
 *    themselves - if so, our writes never update it at all.
 *
 * Usage:
 *   node diagnose-bye-bug.mjs "<path to a save with an already-applied
 *   8 or 16-team bracket>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-bye-bug.mjs "<path to save>"');
  process.exit(1);
}

const CANDIDATE_FLAG_FIELDS = ['HomeScheduled', 'AwayScheduled', 'IsVisitScheduled', 'VisitScheduled', 'GameStatus', 'IsSimmed', 'HasBeenPublished', 'HomeTeamStatus', 'AwayTeamStatus', 'SeasonWeek'];

function decodeRef32(s) {
  if (!s || typeof s !== 'string' || s.length !== 32) return null;
  const t = parseInt(s.slice(0, 15), 2);
  const r = parseInt(s.slice(15), 2);
  if (!t && !r) return null;
  return { tableId: t, row: r };
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const { rowToName, teamRow } = await import('./teamLookup.mjs');

  const seasonTables = franchise.tables.filter(t => t.name === 'SeasonGame');
  let seasonTable = seasonTables[0];
  for (const t of seasonTables) {
    if (t.header.recordCapacity > seasonTable.header.recordCapacity) seasonTable = t;
  }
  await seasonTable.readRecords();

  // --- Part 0: dump the full Round 1 lineup, so you can see exactly which
  // teams are sitting in every bracket-relevant slot right now. Run this
  // against a save BEFORE any Apply to capture the original matchups, so
  // you can rebuild the exact same bracket for a clean re-test.
  console.log('=== Full Round 1 lineup (native slots + regular bowls) ===');
  const REGULAR_BOWL_NAMES = {
    369: 'Xbox Bowl', 370: 'Cure Bowl', 371: 'Boca Raton Bowl', 372: 'New Mexico Bowl',
    373: 'Independence Bowl', 374: '68 Ventures Bowl', 375: 'New Orleans Bowl', 376: 'Myrtle Beach Bowl',
    377: 'Famous Idaho Potato Bowl', 378: 'Frisco Bowl', 379: 'Armed Forces Bowl', 380: 'Gasparilla Bowl',
    381: 'Hawaii Bowl', 382: 'Salute to Veterans Bowl', 383: 'Military Bowl', 384: 'Birmingham Bowl',
    385: 'First Responder Bowl', 386: 'Liberty Bowl', 387: 'Holiday Bowl', 388: 'Rate Bowl',
    389: 'Fenway Bowl', 390: 'Pop-Tarts Bowl', 391: 'Alamo Bowl', 392: "Duke's Mayo Bowl",
    393: 'Music City Bowl', 394: 'Las Vegas Bowl', 395: 'Gator Bowl', 396: 'Sun Bowl',
    397: 'Arizona Bowl', 398: 'Reliaquest Bowl', 399: 'Citrus Bowl', 400: 'Texas Bowl',
  };
  const lineupRecords = { 'Native First Round 1': 924, 'Native First Round 2': 925, 'Native First Round 3': 926, 'Native First Round 4': 927 };
  for (const [num, name] of Object.entries(REGULAR_BOWL_NAMES)) lineupRecords[name] = Number(num);

  for (const [label, idx] of Object.entries(lineupRecords)) {
    const rec = seasonTable.records[idx];
    if (!rec) continue;
    const homeRef = decodeRef32(rec['HomeTeam']);
    const awayRef = decodeRef32(rec['AwayTeam']);
    const homeName = homeRef ? (rowToName(homeRef.row) || `row${homeRef.row}`) : '(null)';
    const awayName = awayRef ? (rowToName(awayRef.row) || `row${awayRef.row}`) : '(null)';
    let weekStr = '';
    try { weekStr = ` [SeasonWeek=${rec['SeasonWeek']}]`; } catch {}
    if (homeRef || awayRef) {
      console.log(`  ${label} (record ${idx}): ${homeName} (HomeTeam) vs ${awayName} (AwayTeam)${weekStr}`);
    }
  }

  // --- Part 1: check flag fields on SeasonGame ---
  const fieldNames = seasonTable.offsetTable.map(f => f.name);
  const presentFlags = CANDIDATE_FLAG_FIELDS.filter(f => fieldNames.includes(f));
  console.log('\nCandidate flag fields actually present on SeasonGame:', presentFlags);

  if (presentFlags.length) {
    // Compare a normal, untouched regular-season game against the bracket
    // records our tool writes to, to look for a mismatch pattern.
    const recordsToCheck = {
      'Championship (401, 2-team)': 401,
      'Native First Round game 1 (924)': 924,
      'Native First Round game 2 (925)': 925,
      'Native First Round game 3 (926)': 926,
      'Native First Round game 4 (927)': 927,
      'Native Quarterfinal 1 (928)': 928,
      'Native Semifinal 1 (932)': 932,
      'A normal regular-season game (record 50, for comparison)': 50,
      'Another normal regular-season game (record 200, for comparison)': 200,
    };
    for (const [label, idx] of Object.entries(recordsToCheck)) {
      console.log(`\n=== ${label} ===`);
      const rec = seasonTable.records[idx];
      if (!rec) { console.log('  (no record)'); continue; }
      const homeRef = decodeRef32(rec['HomeTeam']);
      const awayRef = decodeRef32(rec['AwayTeam']);
      const homeName = homeRef ? (rowToName(homeRef.row) || `row${homeRef.row}`) : '(null)';
      const awayName = awayRef ? (rowToName(awayRef.row) || `row${awayRef.row}`) : '(null)';
      console.log(`  Teams: ${homeName} (HomeTeam field) vs ${awayName} (AwayTeam field)`);
      for (const f of presentFlags) {
        try { console.log(`  ${f} = ${JSON.stringify(rec[f])}`); } catch (err) { console.log(`  ${f} = <error: ${err.message}>`); }
      }
    }
  } else {
    console.log('\nNone of the candidate flags exist on SeasonGame. Full field list:');
    fieldNames.forEach(n => console.log('  ', n));
  }

  // --- Part 2: look for a separate schedule-manager-style table ---
  console.log('\n=== Searching for a separate schedule-manager table ===');
  const scheduleTables = franchise.tables.filter(t =>
    t.name && /schedule/i.test(t.name) && t.name !== 'SeasonGame'
  );
  const uniqueNames = [...new Set(scheduleTables.map(t => t.name))];
  console.log('Table names matching "schedule" (excluding SeasonGame):', uniqueNames);

  for (const name of uniqueNames) {
    const instances = scheduleTables.filter(t => t.name === name);
    let biggest = instances[0];
    for (const t of instances) {
      if (t.header.recordCapacity > biggest.header.recordCapacity) biggest = t;
    }
    console.log(`\n-- ${name} (largest instance, capacity ${biggest.header.recordCapacity}) --`);
    try {
      await biggest.readRecords();
      console.log('  Field names:', biggest.offsetTable.map(f => f.name));
    } catch (err) {
      console.log('  Could not read records:', err.message);
    }
  }

  // --- Part 3 (optional): full SeasonGame search for a specific team ---
  const searchTeamName = process.argv[3];
  if (searchTeamName) {
    console.log(`\n=== Every SeasonGame record involving ${searchTeamName} ===`);
    let targetRow;
    try { targetRow = teamRow(searchTeamName); } catch { console.log('  Could not find that team name.'); return; }
    let found = 0;
    for (let i = 0; i < seasonTable.header.recordCapacity; i++) {
      const rec = seasonTable.records[i];
      if (!rec) continue;
      const homeRef = decodeRef32(rec['HomeTeam']);
      const awayRef = decodeRef32(rec['AwayTeam']);
      if ((homeRef && homeRef.row === targetRow) || (awayRef && awayRef.row === targetRow)) {
        found++;
        const homeName = homeRef ? (rowToName(homeRef.row) || `row${homeRef.row}`) : '(null)';
        const awayName = awayRef ? (rowToName(awayRef.row) || `row${awayRef.row}`) : '(null)';
        let extra = '';
        for (const f of presentFlags) { try { extra += ` ${f}=${JSON.stringify(rec[f])}`; } catch {} }
        console.log(`  record ${i}: ${homeName} vs ${awayName}${extra}`);
      }
    }
    if (!found) console.log('  (no records found - this would be unexpected)');
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
