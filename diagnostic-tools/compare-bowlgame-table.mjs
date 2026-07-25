// Read-only diagnostic - does NOT modify either save.
//
//   node compare-bowlgame-table.mjs "path\to\DYNASTY-VANILLA" "path\to\DYNASTY-SAVEFP"
//
// Dumps the actual BowlGame table (uniqueId 902037496) from both saves,
// record by record, rather than trying to match individual SeasonGame
// records by team pairing (which the previous script did, incorrectly -
// it matched coincidental same-opponent games from entirely different
// seasons, not the same bowl slot before/after MMC).
import path from 'path';
import Franchise from 'madden-franchise';

const [vanillaPath, affectedPath] = process.argv.slice(2);
if (!vanillaPath || !affectedPath) {
  console.error('Usage: node compare-bowlgame-table.mjs <unaffected-save> <affected-save>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const BOWL_GAME_UNIQUE_ID = 902037496;

async function loadBowlGameTable(savePath) {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
  });
  const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
  console.log(`  Found ${matches.length} table(s) with BowlGame's uniqueId, capacities: ${matches.map(t => t.header.recordCapacity).join(', ')}`);
  const table = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await table.readRecords();
  return table;
}

function dumpRecordFields(rec) {
  const out = {};
  const candidateFields = [
    'Name', 'BowlName', 'DisplayName', 'Title', 'GameTitle', 'ShortName',
    'LongName', 'Description', 'BowlSubType', 'Type', 'SponsorName',
  ];
  for (const f of candidateFields) {
    try { out[f] = rec[f]; } catch { /* field doesn't exist under this name on this schema */ }
  }
  return out;
}

console.log('Loading BowlGame table from unaffected save...');
const vanillaTable = await loadBowlGameTable(vanillaPath);
console.log('Loading BowlGame table from affected save...');
const affectedTable = await loadBowlGameTable(affectedPath);

const maxLen = Math.max(vanillaTable.records.length, affectedTable.records.length);
console.log(`\nUnaffected table length: ${vanillaTable.records.length}, affected table length: ${affectedTable.records.length}\n`);

for (let i = 0; i < maxLen; i++) {
  const vRec = vanillaTable.records[i];
  const aRec = affectedTable.records[i];
  const vFields = vRec ? dumpRecordFields(vRec) : null;
  const aFields = aRec ? dumpRecordFields(aRec) : null;
  const vName = vFields ? (vFields.Name ?? vFields.BowlName ?? vFields.DisplayName ?? vFields.Title ?? JSON.stringify(vFields)) : '(no record)';
  const aName = aFields ? (aFields.Name ?? aFields.BowlName ?? aFields.DisplayName ?? aFields.Title ?? JSON.stringify(aFields)) : '(no record)';
  const differs = vName !== aName;
  console.log(`Record ${i}: unaffected="${vName}"  |  affected="${aName}"  ${differs ? '<-- DIFFERS' : ''}`);
}
