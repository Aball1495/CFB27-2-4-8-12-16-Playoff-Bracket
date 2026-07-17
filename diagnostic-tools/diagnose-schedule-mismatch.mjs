#!/usr/bin/env node
/**
 * Diagnostic: the schedule LIST screen and the Dynasty Hub's "Play Game"
 * button appear to disagree after a bracket edit - the list shows the
 * correct new CFP matchup, but "Play Game" still points at a stale,
 * pre-edit opponent. Hypothesis: ScheduleKnownGame / ScheduleStructureEntry
 * / ScheduleStructureEntryExact each have their OWN independent HomeTeam/
 * AwayTeam fields, separate from SeasonGame - if "Play Game" reads from
 * one of these instead, that would explain the mismatch, since our tool
 * has never written to any of them.
 *
 * This searches all three for any record involving a specific team name
 * you give it, and prints what opponent each one currently shows - so we
 * can see directly whether they're stuck on the old matchup.
 *
 * Usage:
 *   node diagnose-schedule-mismatch.mjs "<path to save>" "<team name>"
 *   e.g. node diagnose-schedule-mismatch.mjs "C:\...\save" "North Dakota State"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, teamName] = process.argv.slice(2);
if (!savePath || !teamName) {
  console.error('Usage: node diagnose-schedule-mismatch.mjs "<path to save>" "<team name>"');
  process.exit(1);
}

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
  let targetRow;
  try {
    targetRow = teamRow(teamName);
  } catch (err) {
    console.error(`Could not find team "${teamName}" in team_lookup.json - check spelling.`);
    process.exit(1);
  }
  console.log(`Searching for every schedule entry involving ${teamName} (row ${targetRow})...\n`);

  const tablesToSearch = ['ScheduleKnownGame', 'ScheduleStructureEntry', 'ScheduleStructureEntryExact'];

  for (const tableName of tablesToSearch) {
    console.log(`=== ${tableName} ===`);
    const instances = franchise.tables.filter(t => t.name === tableName);
    if (!instances.length) { console.log('  (table not found)'); continue; }
    let biggest = instances[0];
    for (const t of instances) {
      if (t.header.recordCapacity > biggest.header.recordCapacity) biggest = t;
    }
    await biggest.readRecords();

    let found = 0;
    for (let i = 0; i < biggest.header.recordCapacity; i++) {
      const rec = biggest.records[i];
      if (!rec) continue;
      let homeRef, awayRef;
      try {
        homeRef = decodeRef32(rec['HomeTeam']);
        awayRef = decodeRef32(rec['AwayTeam']);
      } catch { continue; }
      const isMatch = (homeRef && homeRef.row === targetRow) || (awayRef && awayRef.row === targetRow);
      if (isMatch) {
        found++;
        const homeName = homeRef ? (rowToName(homeRef.row) || `row${homeRef.row}`) : '(null)';
        const awayName = awayRef ? (rowToName(awayRef.row) || `row${awayRef.row}`) : '(null)';
        let extra = '';
        try { if (rec['SeasonWeek'] !== undefined) extra += ` SeasonWeek=${rec['SeasonWeek']}`; } catch {}
        try { if (rec['IsEnabled'] !== undefined) extra += ` IsEnabled=${rec['IsEnabled']}`; } catch {}
        console.log(`  record ${i}: ${homeName} (Home) vs ${awayName} (Away)${extra}`);
      }
    }
    if (!found) console.log('  (no matching entries found)');
    console.log('');
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
