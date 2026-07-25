// WRITES to a NEW save file - never touches your original.
//
//   node fix-repurposed-bowl-stadiums-v3.mjs "path\to\save" "path\to\output"
//
// Reads the host team's own PERMANENT Stadium field directly off the
// Team table - not any specific game's Stadium field. A team's home
// venue is a fixed attribute that's always populated, unlike
// individual games, which apparently only get real Stadium data when
// specifically presented (confirmed: Florida's actual regular-season
// home games all showed hasStadium=false - only their one bowl game
// had real data). This sidesteps that entire problem.
//
// NOTE: uses raw HomeTeam (not the swap-aware AwayTeam) because this
// save hasn't had the bracket Applied yet, so these records still hold
// the game's own native default matchup. Once this logic is actually
// integrated into the real tool (running post-Apply), it needs to
// switch back to AwayTeam as the host, per the write-time swap
// convention documented in run-edit's writeGame.
import fs from 'fs';
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, repackSave, REGULAR_BOWLS, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node fix-repurposed-bowl-stadiums-v3.mjs <input-save> <output-save>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;
const STADIUM_FIELD_BYTE_OFFSET = 4; // confirmed: bit offset 32 -> byte 4
const STADIUM_FIELD_BYTE_LENGTH = 4; // 32 bits

const franchise = await Franchise.create(inputPath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const seasonMatches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = seasonMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

const teamMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.Team);
const teamTable = teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await teamTable.readRecords();

function getFieldObj(rec, key) {
  return (rec._fieldsArray || []).find(f => f._key === key);
}
function teamNameOf(rec, key) {
  const f = getFieldObj(rec, key);
  if (!f) return null;
  const ref = f.referenceData;
  if (!ref) return null;
  return rowToName(ref.rowNumber);
}
function findTeamRow(teamName) {
  for (let i = 0; i < teamTable.records.length; i++) {
    const rec = teamTable.records[i];
    if (!rec) continue;
    let name;
    try { name = rowToName(i); } catch { continue; }
    if (name === teamName) return i;
  }
  return null;
}

// Raw buffer for both tables, opened the same way as every other write
// in this tool. Team table's own record layout/offsets needed too.
const { unpackedFileContents, recordsStart, recordSize } = await openSave(inputPath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const teamTableOffset = teamTable.offset + teamTable.header.headerSize;
const teamRecordSize = teamTable.header.record1Size;

const REPURPOSED_BOWL_NAMES = ['Boca Raton Bowl', 'New Orleans Bowl', 'Cure Bowl', 'Gasparilla Bowl'];
let fixedCount = 0;

for (const name of REPURPOSED_BOWL_NAMES) {
  const bowl = REGULAR_BOWLS.find(b => b.name === name);
  const record = bowl.record;
  const rec = seasonTable.records[record];
  const hostTeam = teamNameOf(rec, 'HomeTeam'); // native/default matchup, pre-Apply
  const guestTeam = teamNameOf(rec, 'AwayTeam');
  console.log(`${name} (record ${record}): host=${hostTeam}, guest=${guestTeam}`);

  if (!hostTeam) { console.log('  Could not determine host team - skipping.'); continue; }

  const teamRow = findTeamRow(hostTeam);
  if (teamRow === null) {
    console.log(`  Could not find ${hostTeam} in the Team table - skipping.`);
    continue;
  }

  const teamRec = teamTable.records[teamRow];
  const stadiumField = getFieldObj(teamRec, 'Stadium');
  if (!stadiumField || !stadiumField.value || /^0+$/.test(stadiumField.value)) {
    console.log(`  ${hostTeam}'s own permanent Stadium field is empty - skipping.`);
    continue;
  }

  // Find the Stadium field's byte offset within a Team record - same
  // technique as SeasonGame's, but need to confirm the offset since
  // Team's record layout is completely different (424 fields vs
  // SeasonGame's ~69).
  const teamStadiumOffsetInfo = teamRec._offsetTable?.find(f => f.name === 'Stadium');
  if (!teamStadiumOffsetInfo) {
    console.log(`  Could not find Stadium's byte offset in the Team record layout - skipping.`);
    continue;
  }
  const teamStadiumByteOffset = teamStadiumOffsetInfo.offset / 8;

  console.log(`  Found ${hostTeam}'s permanent home Stadium (Team record ${teamRow}, byte offset ${teamStadiumByteOffset}). Copying raw bytes.`);

  const sourceOffset = teamTableOffset + teamRow * teamRecordSize + teamStadiumByteOffset;
  const targetOffset = recordsStart + record * recordSize + STADIUM_FIELD_BYTE_OFFSET;
  buf.copy(buf, targetOffset, sourceOffset, sourceOffset + STADIUM_FIELD_BYTE_LENGTH);
  fixedCount++;
}

console.log(`\nFixed ${fixedCount} of ${REPURPOSED_BOWL_NAMES.length} repurposed bowl games.`);

if (fixedCount > 0) {
  const originalRawBuf = fs.readFileSync(inputPath);
  const finalBuf = repackSave(originalRawBuf, buf);
  fs.writeFileSync(outputPath, finalBuf);
  console.log(`Saved to: ${outputPath}`);
  console.log('Your original save was never touched.');
} else {
  console.log('Nothing was fixed - no output file written.');
}
