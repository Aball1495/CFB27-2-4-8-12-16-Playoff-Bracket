// Read-only diagnostic - does NOT modify the save.
//
//   node check-stadium-type.mjs "path\to\save"
//
// Resolves Pittsburgh's and Notre Dame's actual Stadium table records
// (via their Team.Stadium reference, same technique proven for the
// earlier fix) and compares STADIUM_FIELDRECIPENAME and Type - looking
// for whatever distinguishes a shared NFL/college venue like Acrisure
// Stadium from a normal campus stadium, since that's the leading
// theory for why field-logo painting doesn't apply there.
import path from 'path';
import Franchise from 'madden-franchise';
import { TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node check-stadium-type.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

const teamMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.Team);
const teamTable = teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await teamTable.readRecords();

function getFieldObj(rec, key) {
  return (rec._fieldsArray || []).find(f => f._key === key);
}
function findTeamRow(teamName) {
  for (let i = 0; i < teamTable.records.length; i++) {
    let name;
    try { name = rowToName(i); } catch { continue; }
    if (name === teamName) return i;
  }
  return null;
}

async function dumpTeamStadium(teamName) {
  const teamRow = findTeamRow(teamName);
  if (teamRow === null) { console.log(`${teamName}: not found in Team table`); return; }
  const teamRec = teamTable.records[teamRow];
  const stadiumField = getFieldObj(teamRec, 'Stadium');
  const ref = stadiumField?.referenceData;
  if (!ref) { console.log(`${teamName}: no Stadium reference found`); return; }

  const stadiumTable = await franchise.getTableById(ref.tableId);
  if (!stadiumTable) { console.log(`${teamName}: getTableById(${ref.tableId}) returned nothing`); return; }
  await stadiumTable.readRecords();
  const stadiumRec = stadiumTable.records[ref.rowNumber];
  if (!stadiumRec) { console.log(`${teamName}: no stadium record at row ${ref.rowNumber}`); return; }

  const fields = {};
  for (const f of ['Name', 'Type', 'STADIUM_FIELDRECIPENAME', 'STADIUM_ASSETNAME', 'STADIUM_DISPLAYNAME', 'STADIUM_ENVIRONMENT', 'STADIUM_ICON', 'STADIUM_FANTASYTOGGLE', 'STADIUM_SIDELINEOBJECTSTOGGLE']) {
    try { fields[f] = stadiumRec[f]; } catch (e) { fields[f] = `<error: ${e.message}>`; }
  }
  console.log(`${teamName} (Stadium table row ${ref.rowNumber}):`, JSON.stringify(fields, null, 2));
}

await dumpTeamStadium('Pittsburgh');
console.log('');
await dumpTeamStadium('Notre Dame');
