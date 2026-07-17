import Franchise from 'madden-franchise';
import path from 'path';
import { teamRow, rowToName } from './teamLookup.mjs';

// Reuse the same uniqueId-based resolution pattern as playoffEditorCore.mjs
const TABLE_UNIQUE_IDS = {
  Team: 3359508968,
};

function resolveTable(franchise, uniqueId, tableName) {
  const matches = franchise.tables.filter(t => t.header.uniqueId === uniqueId);
  if (matches.length === 0) {
    throw new Error(`Table "${tableName}" (uniqueId ${uniqueId}) not found in this save.`);
  }
  return matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
}

// EDIT THESE to match your setup
const SAVE_PATH = process.argv[2] || 'DYNASTY-PLAYOFF12';
const SCHEMA_DIR = process.argv[3] || 'schemas';

// The teams we already have known in-game UI numbers for, from screenshots:
// Nebraska -> in-game shows 3, tool's own bracket seed shows 7
// Miami    -> in-game shows 2, tool's own bracket seed shows 3
// Boise St -> in-game shows 15, tool's own bracket seed shows 10
const CHECK_TEAMS = ['Nebraska', 'Miami', 'Boise State', 'Ohio State', 'Ole Miss', 'BYU'];

const FIELDS = [
  'CFPPoll_CurrentRank',
  'CFPPoll_LastWeeksRank',
  'CFPPoll_CurrentPoints',
  'CoachesPoll_CurrentRank',
  'CoachesPoll_LastWeeksRank',
  'CoachesPoll_HiddenCurrentRank',
  'MediaPoll_CurrentRank',
  'MediaPoll_LastWeeksRank',
  'MediaPoll_HiddenCurrentRank',
  'TeamRank',
];

async function main() {
  const franchise = await Franchise.create(SAVE_PATH, {
    schemaDirectory: SCHEMA_DIR,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(SCHEMA_DIR, '472_0.gz') },
  });

  const teamTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');
  await teamTable.readRecords();

  console.log(`Team table: ${teamTable.records.length} records\n`);
  console.log('Team'.padEnd(16) + FIELDS.map(f => f.padEnd(24)).join(''));
  console.log('-'.repeat(16 + 24 * FIELDS.length));

  for (const teamName of CHECK_TEAMS) {
    let row;
    try {
      row = teamRow(teamName);
    } catch (e) {
      console.log(`${teamName}: ${e.message}`);
      continue;
    }
    const rec = teamTable.records[row];
    if (!rec) {
      console.log(`${teamName} (row ${row}): no record found`);
      continue;
    }
    const values = FIELDS.map(f => {
      try {
        return String(rec[f]).padEnd(24);
      } catch {
        return 'N/A'.padEnd(24);
      }
    });
    console.log(`${teamName.padEnd(16)}${values.join('')}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
