#!/usr/bin/env node
/**
 * ScheduleStructure.TeamSeedsTopRank is an array of Team references,
 * paired with TeamSeedsTopRankValue (a count) - found directly in the
 * game's schema. This table is a singleton we have never touched in this
 * entire investigation. If this array still holds whichever team the
 * game's own native logic originally decided was the top seed (before
 * our tool ever wrote a custom bracket), and something reads THIS array
 * to decide hosting/bye treatment independent of SeasonGame, that could
 * explain why only the actual #1 overall seed (Miami) breaks while other
 * originally-bye teams (who aren't THE #1) work fine.
 *
 * FIXED VERSION: the original diagnose-topseed-array.mjs decoded the
 * TeamSeedsTopRank reference but never actually followed it - it just
 * dumped the first 5 records of any table named "Team[]", which may not
 * be the specific record ScheduleStructure points at. This version
 * follows the exact resolveSlotArray pattern from conferenceMemberships.mjs
 * (already proven working for TeamSlots): decode the outer ref, fetch
 * THAT specific table+row, then decode each of ITS fields as a Team ref.
 *
 * Usage:
 *   node diagnose-topseed-array-fixed.mjs "<path to save>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-topseed-array-fixed.mjs "<path to save>"');
  process.exit(1);
}

function decodeRef32(s) {
  if (!s || typeof s !== 'string' || s.length !== 32) return null;
  const t = parseInt(s.slice(0, 15), 2);
  const r = parseInt(s.slice(15), 2);
  if (!t && !r) return null;
  return { t, r };
}

function getTableIdByName(franchise, name) {
  const matches = franchise.tables.filter(t => t.name === name);
  if (!matches.length) return null;
  return matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a)).header.tableId;
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const { rowToName } = await import('./teamLookup.mjs');

  const teamTableId = getTableIdByName(franchise, 'Team');
  console.log('Team table ID:', teamTableId);

  const structTables = franchise.tables.filter(t => t.name === 'ScheduleStructure');
  console.log(`Found ${structTables.length} instance(s) of ScheduleStructure.`);
  let structTable = structTables[0];
  for (const t of structTables) {
    if (t.header.recordCapacity > structTable.header.recordCapacity) structTable = t;
  }
  await structTable.readRecords();

  const rec = structTable.records[0];
  if (!rec) {
    console.log('No record found on ScheduleStructure.');
    return;
  }

  console.log('\nTeamSeedsTopRankValue =', rec['TeamSeedsTopRankValue']);
  console.log('TeamSeedsTopRank raw field:', rec['TeamSeedsTopRank']);

  const arrRef = decodeRef32(rec['TeamSeedsTopRank']);
  if (!arrRef) {
    console.log('TeamSeedsTopRank decoded as null/empty - array may be unset.');
    return;
  }
  console.log('Decoded outer reference -> table', arrRef.t, 'row', arrRef.r);

  // Follow the reference to the ACTUAL record it points at - this is the
  // step the original script skipped.
  const arrTable = franchise.getTableById(arrRef.t);
  if (!arrTable) {
    console.log(`Could not find table with ID ${arrRef.t}.`);
    return;
  }
  console.log(`Target array table name: "${arrTable.name}", reading its records...`);
  await arrTable.readRecords();

  const fieldNames = arrTable.offsetTable ? arrTable.offsetTable.map(f => f.name) : [];
  const slotsPerRecord = fieldNames.length; // e.g. Team0, Team1 -> 2 slots per record
  const totalNeeded = rec['TeamSeedsTopRankValue'] || 0;
  const rowsNeeded = slotsPerRecord > 0 ? Math.ceil(totalNeeded / slotsPerRecord) : 1;

  console.log(`\nFields per record: ${fieldNames.join(', ')} (${slotsPerRecord} slots/record)`);
  console.log(`Need ${totalNeeded} total entries -> reading rows ${arrRef.r} through ${arrRef.r + rowsNeeded - 1}\n`);

  let foundAny = false;
  let entryIndex = 0;
  for (let rowOffset = 0; rowOffset < rowsNeeded; rowOffset++) {
    const row = arrRef.r + rowOffset;
    const arrRecord = arrTable.records[row];
    if (!arrRecord) {
      console.log(`  [row ${row}] No record found here - stopping.`);
      break;
    }
    for (const fieldName of fieldNames) {
      if (entryIndex >= totalNeeded) break;
      let raw;
      try {
        raw = arrRecord[fieldName];
      } catch (err) {
        console.log(`  [${entryIndex}] ${fieldName} (row ${row}): <threw ${err.message}>`);
        entryIndex++;
        continue;
      }
      const decoded = decodeRef32(raw);
      if (decoded && decoded.t === teamTableId) {
        const name = rowToName(decoded.r);
        console.log(`  [${entryIndex}] ${fieldName} (row ${row}) = ${name} (Team row ${decoded.r})  <-- TEAM REFERENCE`);
        foundAny = true;
      } else if (decoded) {
        console.log(`  [${entryIndex}] ${fieldName} (row ${row}) = ref to table ${decoded.t}, row ${decoded.r} (not the Team table)`);
      } else {
        console.log(`  [${entryIndex}] ${fieldName} (row ${row}) = ${raw}`);
      }
      entryIndex++;
    }
  }

  if (!foundAny) {
    console.log('\nNo fields decoded as a reference into the Team table.');
    console.log('This could mean: the array is genuinely empty/unset, or this field');
    console.log('needs a different access pattern than TeamSlots did - worth pasting');
    console.log('this full output back for a second look if that happens.');
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
