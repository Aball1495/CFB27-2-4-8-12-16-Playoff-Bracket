// WRITES to a NEW save file - never touches your original.
//
//   node fix-repurposed-bowl-stadiums.mjs "path\to\save" "path\to\output"
//
// For each of the 4 repurposed bowl games (written by OUR tool, so
// their true host is the raw AwayTeam field per the swap convention -
// see writeGame's comment in run-edit), finds that host team's own
// real regular-season home Stadium value (any game where they're the
// NATURAL home team, untouched by our swap, in a real regular-season
// week) and copies that exact raw value into the bowl game's Stadium
// field. We never decode what the value actually names - just moves
// the correct raw bits from a game we trust to one we're fixing.
import path from 'path';
import Franchise from 'madden-franchise';
import { BitView } from 'bit-buffer';
import { REGULAR_BOWLS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

function binaryStringToBitView(binStr) {
  // binStr is a string of exactly 32 '0'/'1' characters. Convert to 4
  // real bytes, then wrap in a BitView - setUnformattedValueWithoutChangeEvent
  // rejected a plain string with "Argument must be of type BitView."
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    bytes[i] = parseInt(binStr.slice(i * 8, i * 8 + 8), 2);
  }
  return new BitView(bytes.buffer);
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node fix-repurposed-bowl-stadiums.mjs <input-save> <output-save>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;

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

// Find a real regular-season home Stadium value for a given team name,
// by scanning every record for one where they're the natural home
// team (untouched by our own swap convention, since we never write
// regular season games) in a genuine regular-season week.
function findRegularSeasonStadium(teamName) {
  for (let i = 0; i < seasonTable.records.length; i++) {
    const rec = seasonTable.records[i];
    if (!rec) continue;
    let week;
    try { week = rec['SeasonWeek']; } catch { continue; }
    if (week === undefined || week > 16) continue; // regular season only, not bowl weeks
    if (teamNameOf(rec, 'HomeTeam') !== teamName) continue;
    const stadiumField = getFieldObj(rec, 'Stadium');
    if (!stadiumField || !stadiumField.value || /^0+$/.test(stadiumField.value)) continue;
    return { recordIndex: i, value: stadiumField.value };
  }
  return null;
}

const REPURPOSED_BOWL_NAMES = ['Boca Raton Bowl', 'New Orleans Bowl', 'Cure Bowl', 'Gasparilla Bowl'];
const bowlRecords = REPURPOSED_BOWL_NAMES.map(name => {
  const bowl = REGULAR_BOWLS.find(b => b.name === name);
  return { name, record: bowl.record };
});

for (const { name, record } of bowlRecords) {
  const rec = seasonTable.records[record];
  // True host = raw AwayTeam field, per the swap convention for games
  // our own tool wrote.
  const hostTeam = teamNameOf(rec, 'AwayTeam');
  const guestTeam = teamNameOf(rec, 'HomeTeam');
  console.log(`${name} (record ${record}): host=${hostTeam}, guest=${guestTeam}`);

  if (!hostTeam) {
    console.log('  Could not determine host team - skipping.');
    continue;
  }
  const found = findRegularSeasonStadium(hostTeam);
  if (!found) {
    console.log(`  Could not find a regular-season home Stadium value for ${hostTeam} - skipping.`);
    continue;
  }
  console.log(`  Found ${hostTeam}'s real home Stadium from record ${found.recordIndex}. Copying it in.`);
  const stadiumField = getFieldObj(rec, 'Stadium');
  stadiumField.setUnformattedValueWithoutChangeEvent(binaryStringToBitView(found.value));
}

await franchise.save(outputPath);
console.log(`\nSaved to: ${outputPath}`);
console.log('Your original save was never touched.');
