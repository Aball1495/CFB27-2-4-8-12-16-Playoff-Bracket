#!/usr/bin/env node
/**
 * Restores a coach's fields (from backup-coach.mjs's JSON) onto a NEW
 * coach record - use this on the save from AFTER you've retired the
 * original and the game has auto-assigned some replacement coach to the
 * team. This overwrites that replacement's identity/stats with the
 * backed-up coach's data, so the original comes back looking and playing
 * the same, minus whatever hidden state the game tracks that we can't see.
 *
 * Deliberately does NOT overwrite TeamIndex, PrevTeamIndex, ContractStatus,
 * ContractLength, ContractSalary, ContractYearsRemaining, or
 * SeasonsWithTeam - those describe the NEW coach's actual employment
 * status with this team right now, which is real and correct as-is.
 * Everything else (name, ratings, personality, backstory, career stats,
 * playbooks, etc.) gets overwritten with the original coach's data.
 *
 * Usage:
 *   node restore-coach.mjs "<path to save>" "<output path>" "<backup.json>" "<current first name>" "<current last name>"
 *
 * Example (restoring onto whoever the game auto-hired for Miami):
 *   node restore-coach.mjs "C:\saves\dynasty-post-retire.sav" "C:\saves\dynasty-RESTORED.sav" "lou-hernandez-backup.json" "David" "Braun"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, outputPath, backupJson, curFirst, curLast] = process.argv.slice(2);
if (!savePath || !outputPath || !backupJson || !curFirst || !curLast) {
  console.error('Usage: node restore-coach.mjs "<path to save>" "<output path>" "<backup.json>" "<current first name>" "<current last name>"');
  process.exit(1);
}

// Fields describing the CURRENT employment relationship - never overwrite
// these, since they reflect the new coach's real, valid contract state.
const PRESERVE_FIELDS = new Set([
  'TeamIndex', 'PrevTeamIndex', 'ContractStatus', 'ContractLength',
  'ContractSalary', 'ContractYearsRemaining', 'SeasonsWithTeam',
  'CurrentJobSecurityStatus', 'SeasonStartJobSecurityStatus',
  'CurrentJobSecurityPercentage', 'CurrentJobSecurityPercentageRank',
]);

function cleanName(s) {
  if (s == null) return '';
  return String(s).replace(/[\x00-\x1F]/g, '').trim();
}

async function main() {
  const backup = JSON.parse(fs.readFileSync(backupJson, 'utf8'));

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

  const wantFirst = cleanName(curFirst).toLowerCase();
  const wantLast = cleanName(curLast).toLowerCase();

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
    console.error(`Could not find an exact match for "${curFirst} ${curLast}" to overwrite.`);
    if (nearMatches.length) {
      console.error('\nClosest matches found instead:');
      for (const m of nearMatches.slice(0, 15)) {
        console.error(`  Row ${m.i}: "${m.fn}" "${m.ln}"`);
      }
    }
    process.exit(1);
  }

  console.log(`Overwriting coach at row ${targetIndex} (currently "${curFirst} ${curLast}") with backed-up data.`);
  console.log(`Backup was originally from row ${backup._sourceRow}.\n`);

  let written = 0, skipped = 0, failed = 0;
  const failedFields = [];
  for (const [field, value] of Object.entries(backup._fields)) {
    if (PRESERVE_FIELDS.has(field)) {
      skipped++;
      continue;
    }
    try {
      targetRecord[field] = value;
      written++;
    } catch (err) {
      failed++;
      failedFields.push(`${field} (${err.message})`);
    }
  }

  console.log(`Wrote ${written} fields, preserved ${skipped} employment fields, failed on ${failed}.`);
  if (failedFields.length) {
    console.log('Failed fields (likely complex/array types that need different handling):');
    console.log('  ' + failedFields.join('\n  '));
  }

  await franchise.save(outputPath);
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
