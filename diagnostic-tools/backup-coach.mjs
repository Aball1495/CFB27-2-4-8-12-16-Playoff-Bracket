#!/usr/bin/env node
/**
 * Backs up a coach's ENTIRE record (every field the schema knows about)
 * to a JSON file, before you retire them in-game. Pair with
 * restore-coach.mjs afterward to recreate an identical coach post-retirement.
 *
 * Usage:
 *   node backup-coach.mjs "<path to save>" "<first name>" "<last name>" "<output.json>"
 *
 * Example:
 *   node backup-coach.mjs "C:\saves\dynasty.sav" "Lou" "Hernandez" "lou-hernandez-backup.json"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, firstName, lastName, outputJson] = process.argv.slice(2);
if (!savePath || !firstName || !lastName || !outputJson) {
  console.error('Usage: node backup-coach.mjs "<path to save>" "<first name>" "<last name>" "<output.json>"');
  process.exit(1);
}

function cleanName(s) {
  if (s == null) return '';
  // Strip null bytes/control chars that fixed-length string fields can
  // leave behind, then trim ordinary whitespace, then lowercase for a
  // forgiving compare.
  return String(s).replace(/[\x00-\x1F]/g, '').trim();
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const coachTables = franchise.tables.filter(t => t.name === 'Coach');
  let coachTable = coachTables[0];
  for (const t of coachTables) {
    if (t.header.recordCapacity > coachTable.header.recordCapacity) coachTable = t;
  }
  await coachTable.readRecords();

  const fieldNames = coachTable.offsetTable.map(f => f.name);
  const wantFirst = cleanName(firstName).toLowerCase();
  const wantLast = cleanName(lastName).toLowerCase();

  let targetIndex = -1;
  let targetRecord = null;
  const nearMatches = [];
  for (let i = 0; i < coachTable.records.length; i++) {
    const rec = coachTable.records[i];
    if (!rec) continue;
    let fn, ln;
    try {
      fn = cleanName(rec['FirstName']);
      ln = cleanName(rec['LastName']);
    } catch {
      continue;
    }
    if (fn.toLowerCase() === wantFirst && ln.toLowerCase() === wantLast) {
      targetIndex = i;
      targetRecord = rec;
      break;
    }
    if (fn.toLowerCase().includes(wantFirst) || ln.toLowerCase().includes(wantLast)) {
      nearMatches.push({ i, fn, ln });
    }
  }

  if (!targetRecord) {
    console.error(`Could not find an exact match for "${firstName} ${lastName}".`);
    if (nearMatches.length) {
      console.error('\nClosest matches found instead:');
      for (const m of nearMatches.slice(0, 15)) {
        console.error(`  Row ${m.i}: "${m.fn}" "${m.ln}"`);
      }
    } else {
      console.error('No near-matches either - double check spelling, or the save may not have been saved after creating this coach.');
    }
    process.exit(1);
  }

  console.log(`Found ${firstName} ${lastName} at Coach table row ${targetIndex}.`);

  const backup = { _sourceRow: targetIndex, _fields: {} };
  const failedFields = [];
  for (const f of fieldNames) {
    try {
      backup._fields[f] = targetRecord[f];
    } catch (err) {
      failedFields.push(f);
    }
  }

  fs.writeFileSync(outputJson, JSON.stringify(backup, null, 2));
  console.log(`Backed up ${Object.keys(backup._fields).length} of ${fieldNames.length} fields to ${outputJson}.`);
  if (failedFields.length) {
    console.log(`Could not read (skipped): ${failedFields.join(', ')}`);
  }
  console.log('\nSafe to retire this coach in-game now.');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
