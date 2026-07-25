// WRITES to a NEW save file - never touches your original.
//
//   node fix-repurposed-bowl-stadiums-v2.mjs "path\to\save" "path\to\output"
//
// Same fix as before, but bypasses the FranchiseFileField write API
// entirely (it wants an internal BitView class we can't reliably
// construct from outside the library) and instead does a direct raw
// byte copy, using the same openSave/repackSave infrastructure every
// other write in this whole tool already relies on. Stadium's bit
// offset within a SeasonGame record is confirmed to be 32 (byte 4),
// 32 bits (4 bytes) wide - byte-aligned, so a straight 4-byte copy is
// exactly correct with no bit-shifting needed.
import fs from 'fs';
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, repackSave, REGULAR_BOWLS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node fix-repurposed-bowl-stadiums-v2.mjs <input-save> <output-save>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;
const STADIUM_FIELD_BYTE_OFFSET = 4; // confirmed: bit offset 32 -> byte 4
const STADIUM_FIELD_BYTE_LENGTH = 4; // 32 bits

// Franchise (for reading team/week/name info via the schema-aware API,
// same as every earlier diagnostic).
const franchise = await Franchise.create(inputPath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

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
function findRegularSeasonStadiumRecord(teamName) {
  // Week <=15 specifically, not the SeasonWeekType enum - Week 16 is
  // Conference Championship week, which the enum still tags as
  // "RegularSeason" even though championship games are frequently
  // played at a neutral site in real life (confirmed: that's exactly
  // what produced the wrong Camping World Stadium result). Collecting
  // every match rather than just the first, same majority-vote logic
  // as before, now with a cleaner pool to vote from.
  const valueCounts = new Map();
  for (let i = 0; i < seasonTable.records.length; i++) {
    const rec = seasonTable.records[i];
    if (!rec) continue;
    let week;
    try { week = rec['SeasonWeek']; } catch { continue; }
    if (week === undefined || week > 15) continue;
    if (teamNameOf(rec, 'HomeTeam') !== teamName) continue;
    const stadiumField = getFieldObj(rec, 'Stadium');
    if (!stadiumField || !stadiumField.value || /^0+$/.test(stadiumField.value)) continue;
    const val = stadiumField.value;
    if (!valueCounts.has(val)) valueCounts.set(val, { count: 0, firstRecordIndex: i });
    valueCounts.get(val).count++;
  }
  if (valueCounts.size === 0) return null;
  let best = null;
  let total = 0;
  for (const [val, info] of valueCounts) {
    total += info.count;
    if (!best || info.count > best.count) best = { value: val, count: info.count, recordIndex: info.firstRecordIndex };
  }
  return { recordIndex: best.recordIndex, confidence: `${best.count}/${total}` };
}

// Raw buffer, opened the same way as every other write in this tool.
const { unpackedFileContents, recordsStart, recordSize } = await openSave(inputPath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const REPURPOSED_BOWL_NAMES = ['Boca Raton Bowl', 'New Orleans Bowl', 'Cure Bowl', 'Gasparilla Bowl'];
let fixedCount = 0;

for (const name of REPURPOSED_BOWL_NAMES) {
  const bowl = REGULAR_BOWLS.find(b => b.name === name);
  const record = bowl.record;
  const rec = seasonTable.records[record];
  // NOTE: this is HomeTeam, not AwayTeam - because on THIS save the
  // bracket hasn't been Applied yet, so this record still holds the
  // game's own native default matchup, which follows the normal
  // (non-swapped) convention. Confirmed directly: Georgia State shows
  // as home in-game right now for this exact game. The swap convention
  // (host = AwayTeam) only applies AFTER our own tool has actually
  // written to this record - this script would need to switch back to
  // that once it's being run post-Apply instead of pre-Apply.
  const hostTeam = teamNameOf(rec, 'HomeTeam');
  const guestTeam = teamNameOf(rec, 'AwayTeam');
  console.log(`${name} (record ${record}): host=${hostTeam}, guest=${guestTeam}`);

  if (!hostTeam) { console.log('  Could not determine host team - skipping.'); continue; }
  const found = findRegularSeasonStadiumRecord(hostTeam);
  if (found === null) {
    console.log(`  Could not find a regular-season home Stadium value for ${hostTeam} - skipping.`);
    continue;
  }
  console.log(`  Found ${hostTeam}'s most common home Stadium value (agreement: ${found.confidence} home games) from record ${found.recordIndex}. Copying raw bytes.`);

  const sourceOffset = recordsStart + found.recordIndex * recordSize + STADIUM_FIELD_BYTE_OFFSET;
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
