#!/usr/bin/env node
/**
 * Writes a new team into ScheduleStructure.TeamSeedsTopRank's first slot,
 * replacing whatever's there now. This is a direct empirical test of the
 * theory that this stale field (still pointing at the game's OLD native
 * #1 seed) gates some hosting/display behavior for whichever team it
 * names - independent of SeasonGame, independent of Team, independent of
 * anything the bracket tool itself writes (confirmed via code read: this
 * field is never touched anywhere in main.cjs/playoffEditorCore.mjs).
 *
 * This does NOT touch anything else - not SeasonGame, not the bracket,
 * not Team records. Just this one field, so the before/after comparison
 * in-game is as clean as possible.
 *
 * Usage:
 *   node write-topseed.mjs "<path to save>" "<output path>" "<new team name>"
 *
 * Example:
 *   node write-topseed.mjs "C:\saves\dynasty.sav" "C:\saves\dynasty-TOPSEED-TEST.sav" "Miami"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, outputPath, newTeamName] = process.argv.slice(2);
if (!savePath || !outputPath || !newTeamName) {
  console.error('Usage: node write-topseed.mjs "<path to save>" "<output path>" "<new team name>"');
  process.exit(1);
}

function decodeRef32(s) {
  if (!s || typeof s !== 'string' || s.length !== 32) return null;
  const t = parseInt(s.slice(0, 15), 2);
  const r = parseInt(s.slice(15), 2);
  if (!t && !r) return null;
  return { t, r };
}

function encodeRef32(tableId, row) {
  const tBits = tableId.toString(2).padStart(15, '0');
  const rBits = row.toString(2).padStart(17, '0');
  return tBits + rBits;
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const { teamRow, rowToName } = await import('./teamLookup.mjs');
  const targetRow = teamRow(newTeamName);
  console.log(`Target: ${newTeamName} (Team row ${targetRow})`);

  const teamTableId = franchise.tables
    .filter(t => t.name === 'Team')
    .reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a))
    .header.tableId;

  const structTables = franchise.tables.filter(t => t.name === 'ScheduleStructure');
  let structTable = structTables[0];
  for (const t of structTables) {
    if (t.header.recordCapacity > structTable.header.recordCapacity) structTable = t;
  }
  await structTable.readRecords();
  const rec = structTable.records[0];

  const arrRef = decodeRef32(rec['TeamSeedsTopRank']);
  if (!arrRef) {
    console.error('TeamSeedsTopRank is null/empty on this save - nothing to overwrite.');
    process.exit(1);
  }

  const arrTable = franchise.getTableById(arrRef.t);
  await arrTable.readRecords();
  const arrRecord = arrTable.records[arrRef.r];
  if (!arrRecord) {
    console.error(`No record at row ${arrRef.r} in table "${arrTable.name}".`);
    process.exit(1);
  }

  const before = decodeRef32(arrRecord['Team0']);
  const beforeName = before && before.t === teamTableId ? rowToName(before.r) : '(none)';
  console.log(`Before: Team0 = ${beforeName}`);

  arrRecord['Team0'] = encodeRef32(teamTableId, targetRow);
  console.log(`After:  Team0 = ${newTeamName}`);

  await franchise.save(outputPath);
  console.log(`\nSaved to: ${outputPath}`);
  console.log('Nothing else was touched - only this one field changed.');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
