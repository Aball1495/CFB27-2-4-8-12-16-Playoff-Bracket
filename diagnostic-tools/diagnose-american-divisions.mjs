import path from 'path';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { teamRow, rowToName } from './teamLookup.mjs';

const SAVE_PATH = process.argv[2];
const SCHEMA_DIR = process.argv[3] || 'schemas';

if (!SAVE_PATH) {
  console.error('Usage: node diagnose-american-divisions.mjs <savePath> [schemaDir]');
  process.exit(1);
}

// From the standings screenshot - the full American conference membership.
const AMERICAN_TEAMS = [
  'USF', 'UAB', 'UTSA', 'Memphis', 'East Carolina', 'Tulsa',
  'Florida Atlantic', 'Temple', 'Tulane', 'Charlotte', 'North Texas', 'Rice',
];

async function main() {
  const Franchise = (await import('madden-franchise')).default;
  const franchise = await Franchise.create(SAVE_PATH, {
    schemaDirectory: SCHEMA_DIR,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(SCHEMA_DIR, '472_0.gz') },
  });

  const teamTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');
  await teamTable.readRecords();

  console.log('Team'.padEnd(18) + 'DIV_SLOTNUMBER'.padEnd(16) + 'ConfW-L'.padEnd(10) + 'NonConfW-L');
  console.log('-'.repeat(60));

  const divisions = new Map();
  for (const name of AMERICAN_TEAMS) {
    const row = teamRow(name);
    const rec = teamTable.records[row];
    if (!rec) { console.log(`${name}: no record found`); continue; }

    let div, confW, confL, nonConfW, nonConfL;
    try { div = rec['DIV_SLOTNUMBER']; } catch (e) { div = `ERR: ${e.message}`; }
    try { confW = rec['ConfWin']; } catch { confW = '?'; }
    try { confL = rec['ConfLoss']; } catch { confL = '?'; }
    try { nonConfW = rec['NonConfWin']; } catch { nonConfW = '?'; }
    try { nonConfL = rec['NonConfLoss']; } catch { nonConfL = '?'; }

    console.log(
      name.padEnd(18) + String(div).padEnd(16) + `${confW}-${confL}`.padEnd(10) + `${nonConfW}-${nonConfL}`
    );

    if (!divisions.has(div)) divisions.set(div, []);
    divisions.get(div).push(name);
  }

  console.log('\nGrouped by DIV_SLOTNUMBER:');
  for (const [div, teams] of divisions.entries()) {
    console.log(`  ${div}: ${teams.join(', ')}`);
  }
  if (divisions.size > 1) {
    console.log('\nMultiple distinct DIV_SLOTNUMBER values found - American does have a division split.');
    console.log('Confirms the top-2-overall heuristic is the wrong model for this conference.');
  } else {
    console.log('\nOnly one DIV_SLOTNUMBER value found - divisions are NOT the explanation here.');
    console.log('Something else is causing Memphis to be the actual champion despite the weaker record.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
