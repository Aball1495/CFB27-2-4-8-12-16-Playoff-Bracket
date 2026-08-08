// Read-only diagnostic - does NOT modify the save.
//
//   node check-player-stat-history.mjs "path\to\save" "First" "Last"
//
// PlayerStatRecord has BOTH a TeamRef (reference-type field, same
// problematic category as Stadium/HomeTeam/AwayTeam all session) AND a
// separate teamName string field, cached alongside it. If a player's
// current roster is correct but their season stat history is wrong,
// checking whether teamName and TeamRef's decoded team AGREE on the
// same record tells us directly whether this is row-drift (TeamRef
// pointing at a stale/wrong row) or something else entirely.
import path from 'path';
import Franchise from 'madden-franchise';
import { TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath, firstName, lastName] = process.argv.slice(2);
if (!savePath || !firstName || !lastName) {
  console.error('Usage: node check-player-stat-history.mjs <save-path> "<First>" "<Last>"');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

// Find the PlayerStatRecord table by name directly, since we don't yet
// have a confirmed uniqueId constant for it like the other tables.
const candidates = franchise.tables.filter(t => t.header.name === 'PlayerStatRecord');
if (!candidates.length) {
  console.error('Could not find a PlayerStatRecord table by name - the actual table name may differ from the schema. Run with --list to see all table names.');
  process.exit(1);
}
const statTable = candidates.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await statTable.readRecords();

function getFieldObj(rec, key) { return (rec._fieldsArray || []).find(f => f._key === key); }

let found = 0;
for (let i = 0; i < statTable.records.length; i++) {
  const rec = statTable.records[i];
  if (!rec) continue;
  let first, last;
  try { first = rec['firstName']; last = rec['lastName']; } catch { continue; }
  if (first !== firstName || last !== lastName) continue;

  found++;
  let year, statType, statValue, teamNameField;
  try { year = rec['calendarYear']; } catch { year = '<error>'; }
  try { statType = rec['statType']; } catch { statType = '<error>'; }
  try { statValue = rec['statValue']; } catch { statValue = '<error>'; }
  try { teamNameField = rec['teamName']; } catch { teamNameField = '<error>'; }

  const teamRefField = getFieldObj(rec, 'TeamRef');
  const ref = teamRefField?.referenceData;
  let decodedTeamName = '<could not decode>';
  if (ref && ref.rowNumber !== undefined) {
    try { decodedTeamName = rowToName(ref.rowNumber); } catch { decodedTeamName = `<row ${ref.rowNumber}, name lookup failed>`; }
  }

  const agree = decodedTeamName === teamNameField;
  console.log(`Record ${i}: year=${year}, statType=${statType}, statValue=${statValue}`);
  console.log(`  teamName (string field): "${teamNameField}"`);
  console.log(`  TeamRef decodes to: "${decodedTeamName}" (row ${ref?.rowNumber})`);
  console.log(`  ${agree ? 'AGREE' : '*** MISMATCH ***'}`);
  console.log('');
}
console.log(`Total PlayerStatRecord entries found for ${firstName} ${lastName}: ${found}`);
