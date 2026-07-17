#!/usr/bin/env node
/**
 * Diagnostic: locate the Championship game's SeasonGame record. Run this
 * against a save where you're sitting at Championship week with both real
 * finalists already locked in - it searches every record in the table for
 * whichever one has exactly those two teams as home/away.
 *
 * Usage:
 *   node diagnose-championship-slot.mjs "<path to save>" "<Team A>" "<Team B>"
 *
 * Example:
 *   node diagnose-championship-slot.mjs "C:\...\DYNASTY-TEST" "Texas A&M" "Ohio State"
 */
import { openSave, readMatchup } from './playoffEditorCore.mjs';
import { teamRow, rowToName } from './teamLookup.mjs';

const [savePath, teamAName, teamBName] = process.argv.slice(2);
if (!savePath || !teamAName || !teamBName) {
  console.error('Usage: node diagnose-championship-slot.mjs "<path to save>" "<Team A>" "<Team B>"');
  process.exit(1);
}

async function main() {
  const rowA = teamRow(teamAName);
  const rowB = teamRow(teamBName);
  console.log(`Looking for a SeasonGame record with ${teamAName} (row ${rowA}) and ${teamBName} (row ${rowB})...`);

  const { unpackedFileContents, recordsStart, recordSize, recordCount } =
    await openSave(savePath, './schemas');
  const buf = Buffer.from(unpackedFileContents);

  const matches = [];
  for (let i = 0; i < recordCount; i++) {
    const m = readMatchup(buf, recordsStart, recordSize, i);
    const pair = [m.home.row, m.away.row];
    if (pair.includes(rowA) && pair.includes(rowB)) {
      matches.push({ record: i, home: rowToName(m.home.row), away: rowToName(m.away.row) });
    }
  }

  if (matches.length === 0) {
    console.log('\nNo record found with both teams. Double check:');
    console.log('  - the team names match team_lookup.json spelling');
    console.log('  - this save really has both finalists locked into the Championship game right now');
  } else {
    console.log(`\nFound ${matches.length} matching record(s):`);
    matches.forEach(m => console.log(`  Record ${m.record}: home=${m.home}, away=${m.away}`));
    console.log('\nWe already know Semifinals are records 932 and 933 - if you see exactly one');
    console.log('match and it\'s close to those (e.g. 934 or 935), that\'s almost certainly the');
    console.log('real Championship slot. If you see more than one match, the right one is');
    console.log('whichever is near 932-935, not an earlier-season record (a random regular-season');
    console.log('or conference-championship game between the same two teams would also match).');
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
