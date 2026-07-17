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
 * Usage:
 *   node diagnose-topseed-array.mjs "<path to save>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-topseed-array.mjs "<path to save>"');
  process.exit(1);
}

function decodeRef32(s) {
  if (!s || typeof s !== 'string' || s.length !== 32) return null;
  const t = parseInt(s.slice(0, 15), 2);
  const r = parseInt(s.slice(15), 2);
  if (!t && !r) return null;
  return { tableId: t, row: r };
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const { rowToName } = await import('./teamLookup.mjs');

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

  const arrRef = decodeRef32(rec['TeamSeedsTopRank']);
  console.log('TeamSeedsTopRank raw field:', rec['TeamSeedsTopRank']);
  if (arrRef) {
    console.log('Decoded as a reference:', arrRef);
  }

  // TeamSeedsTopRank is an array-type field - try reading it as an array table
  try {
    const arrTableName = 'Team[]';
    const arrTables = franchise.tables.filter(t => t.name === arrTableName);
    console.log(`\nLooking inside any Team[] array tables for the actual team refs (${arrTables.length} found)...`);
    for (const t of arrTables) {
      await t.readRecords();
      for (let i = 0; i < Math.min(t.header.recordCapacity, 5); i++) {
        const arrRec = t.records[i];
        if (!arrRec) continue;
        const fields = t.offsetTable.map(f => f.name);
        for (const f of fields) {
          const ref = decodeRef32(arrRec[f]);
          if (ref && ref.tableId !== 0) {
            const name = rowToName(ref.row) || `row${ref.row}`;
            console.log(`  ${arrTableName}[${i}].${f} = ${name} (row ${ref.row})`);
          }
        }
      }
    }
  } catch (err) {
    console.log('Could not read Team[] array tables:', err.message);
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
