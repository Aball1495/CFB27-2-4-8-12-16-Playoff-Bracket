#!/usr/bin/env node
/**
 * New hypothesis: everything checked so far has been on SeasonGame or the
 * various Schedule* tables. This checks the TEAM table itself for any
 * field that looks like a "current game" / "this week's game" pointer -
 * if North Dakota State's own team record still points at record 377
 * (her original bowl assignment before we moved her into the bracket at
 * 924), that would explain the Dynasty Hub showing Southern Miss (who our
 * own dummy-swap correctly placed into 377 after moving NDSU out) without
 * ever checking whether NDSU is still actually in that game.
 *
 * Usage:
 *   node diagnose-team-game-pointer.mjs "<path to save>" "<team name>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, teamName] = process.argv.slice(2);
if (!savePath || !teamName) {
  console.error('Usage: node diagnose-team-game-pointer.mjs "<path to save>" "<team name>"');
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

  const { teamRow } = await import('./teamLookup.mjs');
  const targetRow = teamRow(teamName);
  console.log(`Looking up ${teamName} (row ${targetRow}) on the Team table...\n`);

  const teamTables = franchise.tables.filter(t => t.name === 'Team');
  let teamTable = teamTables[0];
  for (const t of teamTables) {
    if (t.header.recordCapacity > teamTable.header.recordCapacity) teamTable = t;
  }
  await teamTable.readRecords();

  const rec = teamTable.records[targetRow];
  if (!rec) {
    console.log('Could not find that team\'s own record - check the row number is right.');
    return;
  }

  const fieldNames = teamTable.offsetTable.map(f => f.name);
  console.log(`Full field list on Team (${fieldNames.length} fields):`);
  console.log(fieldNames.join(', '));

  console.log('\nLooking for anything game/schedule/week related specifically...');
  const candidates = fieldNames.filter(f => /game|schedule|week|opponent|next|current|playoff|topseed|host|homefield/i.test(f));
  console.log('Candidate fields:', candidates);

  for (const f of candidates) {
    try {
      const val = rec[f];
      const decoded = decodeRef32(val);
      if (decoded) {
        console.log(`  ${f} = ref(tableId=${decoded.tableId}, row=${decoded.row})`);
      } else {
        console.log(`  ${f} = ${JSON.stringify(val)}`);
      }
    } catch (err) {
      console.log(`  ${f} = <error reading: ${err.message}>`);
    }
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
