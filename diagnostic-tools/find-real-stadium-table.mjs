// Read-only diagnostic - does NOT modify the save.
//
//   node find-real-stadium-table.mjs "path\to\save" "Team Name"
//
// The table literally named "Stadium" turned out to be vestigial/blank
// in this save (confirmed - every one of its 183 rows is identical and
// empty). copyTeamStadiumIntoGame demonstrably works in practice, but it
// works by copying raw BYTES directly - it never decodes the reference.
// A first attempt at decoding via the field library's own .value string
// getter produced an implausible result (tableId 16434, row 85113 - no
// table in this game has that many rows), meaning that getter's string
// format doesn't actually match the raw 32-bit word layout. This version
// reads the raw bytes directly from the buffer at the same offset
// copyTeamStadiumIntoGame already uses successfully, then decodes THAT.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath, teamName] = process.argv.slice(2);
if (!savePath || !teamName) {
  console.error('Usage: node find-real-stadium-table.mjs <save-path> "<Team Name>"');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) {
  return { tableId: word >>> 17, row: word & 0x1ffff };
}
function getFieldObj(rec, key) { return (rec._fieldsArray || []).find(f => f._key === key); }
function getAllFields(r) {
  const out = {};
  for (const f of (r._fieldsArray || [])) {
    try { out[f._key] = r[f._key]; } catch { out[f._key] = '<threw>'; }
  }
  return out;
}

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});

const teamMatches = franchise.tables.filter(t => t.header.name === 'Team');
if (!teamMatches.length) { console.error('Could not find a table named "Team".'); process.exit(1); }
const teamTable = teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await teamTable.readRecords();

function findTeamRow(name) {
  for (let i = 0; i < teamTable.records.length; i++) {
    let n;
    try { n = teamTable.records[i]?.['TEAM_PREFIX_NAME']; } catch { continue; }
    if (n === name) return i;
  }
  return -1;
}

let teamRow = /^\d+$/.test(teamName) ? parseInt(teamName, 10) : findTeamRow(teamName);
if (teamRow === -1) {
  console.log(`Could not find "${teamName}" by TEAM_PREFIX_NAME. Printing the first 20 rows' TEAM_PREFIX_NAME values so we can find the right one (or just pass the row number directly, e.g. from team_lookup.json):\n`);
  for (let i = 0; i < Math.min(20, teamTable.records.length); i++) {
    const rec = teamTable.records[i];
    if (!rec) continue;
    let n; try { n = rec['TEAM_PREFIX_NAME']; } catch { n = '<threw>'; }
    console.log(`row ${i}: TEAM_PREFIX_NAME="${n}"`);
  }
  process.exit(0);
}

// Sanity check, always - whether teamRow came from a name match above or
// was passed straight in as a number (e.g. from team_lookup.json), never
// trust it blind. Print what THIS save's own data says is actually at
// that row before drawing any conclusion from it - team_lookup.json is a
// separately-maintained static file, not read from this save, and
// trusting a static mapping without checking it against the real data
// is exactly what caused the TeamPrefixName bug earlier this session.
let actualPrefix;
try { actualPrefix = teamTable.records[teamRow]?.['TEAM_PREFIX_NAME']; } catch { actualPrefix = '<threw>'; }
console.log(`Row ${teamRow} in THIS save's Team table has TEAM_PREFIX_NAME="${actualPrefix}". Confirm that's actually ${teamName} before trusting anything below.`);

// Read the raw bytes directly, same offset math as copyTeamStadiumIntoGame.
const teamRec = teamTable.records[teamRow];
const stadiumOffsetInfo = teamRec._offsetTable?.find(f => f.name === 'Stadium');
if (!stadiumOffsetInfo) { console.error("Could not resolve Stadium's byte offset."); process.exit(1); }
const byteOffset = stadiumOffsetInfo.offset / 8;
const teamTableOffset = teamTable.offset + teamTable.header.headerSize;
const teamRecordSize = teamTable.header.record1Size;
const sourceOffset = teamTableOffset + teamRow * teamRecordSize + byteOffset;

// This save is FBCHUNKS-compressed - franchise.unpackedFileContents is the
// decompressed buffer these offsets are relative to, not the raw file.
const buf = Buffer.from(franchise.unpackedFileContents);
const word = buf.readUInt32BE(sourceOffset);
console.log(`Raw 32-bit word at offset ${sourceOffset}: ${word} (0x${word.toString(16)})`);
const decoded = decodeRef(word);
console.log(`Decoded -> tableId=${decoded.tableId}, row=${decoded.row}`);

const realStadiumTable = franchise.tables.find(t => t.header.tableId === decoded.tableId);
if (!realStadiumTable) {
  console.log(`No table found with tableId=${decoded.tableId} in this franchise's table list. Listing all tables with recordCapacity between 50 and 500 (likely candidates for a stadium-scale table):`);
  franchise.tables
    .filter(t => t.header.recordCapacity >= 50 && t.header.recordCapacity <= 500)
    .forEach(t => console.log(`  "${t.header.name}" tableId=${t.header.tableId} recordCapacity=${t.header.recordCapacity}`));
  process.exit(0);
}
console.log(`\nFound the real table: name="${realStadiumTable.header.name}" recordCapacity=${realStadiumTable.header.recordCapacity}`);
await realStadiumTable.readRecords();
const rec = realStadiumTable.records[decoded.row];
if (!rec) {
  console.log(`Row ${decoded.row} is null/empty in that table.`);
  process.exit(0);
}
console.log(`\nFull fields for ${teamName}'s actual stadium record (row ${decoded.row}):\n`);
console.log(JSON.stringify(getAllFields(rec), null, 2));
