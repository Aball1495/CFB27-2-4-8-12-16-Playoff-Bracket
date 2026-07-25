// Read-only diagnostic - does NOT modify the save.
//
//   node check-bowlgame-reference.mjs "path\to\save"
//
// SeasonGame records have their own BowlGame reference field (separate
// from the BowlGame table's Name string we already fixed). Checking
// whether a repurposed bowl's game record still points at the
// ORIGINAL bowl definition (e.g. "Boca Raton Bowl", with whatever
// PresentationId that carries) versus a genuine native CFP First
// Round slot's BowlGame reference and PresentationId - if repurposed
// bowls still reference the wrong BowlGame record, retargeting that
// one reference might fix branding AND graphics in a single write.
import path from 'path';
import Franchise from 'madden-franchise';
import { REGULAR_BOWLS, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node check-bowlgame-reference.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;
const BOWL_GAME_UNIQUE_ID = 902037496;

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const seasonMatches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = seasonMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

const bowlMatches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
const bowlTable = bowlMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await bowlTable.readRecords();

function getFieldObj(rec, key) {
  return (rec._fieldsArray || []).find(f => f._key === key);
}

function describeGame(seasonRecordIndex, label) {
  const rec = seasonTable.records[seasonRecordIndex];
  if (!rec) { console.log(`${label} (record ${seasonRecordIndex}): no record`); return; }
  const bowlField = getFieldObj(rec, 'BowlGame');
  if (!bowlField) { console.log(`${label} (record ${seasonRecordIndex}): no BowlGame field object`); return; }
  const ref = bowlField.referenceData;
  console.log(`${label} (SeasonGame record ${seasonRecordIndex}): BowlGame referenceData = tableId=${ref?.tableId}, row=${ref?.rowNumber}`);
  if (ref && ref.rowNumber !== undefined) {
    const bowlRec = bowlTable.records[ref.rowNumber];
    if (bowlRec) {
      let name = null, presId = null, isPlayoff = null, slot = null;
      try { name = bowlRec['Name']; } catch {}
      try { presId = bowlRec['PresentationId']; } catch {}
      try { isPlayoff = bowlRec['IsPlayoffBowl']; } catch {}
      try { slot = bowlRec['PlayoffBracketSlot']; } catch {}
      console.log(`  -> BowlGame table row ${ref.rowNumber}: Name="${name}", PresentationId=${presId}, IsPlayoffBowl=${isPlayoff}, PlayoffBracketSlot=${slot}`);
    } else {
      console.log(`  -> BowlGame table row ${ref.rowNumber}: no record found there`);
    }
  }
}

console.log('=== Repurposed bowls (used as extra Round 1 slots) ===');
for (const name of ['Boca Raton Bowl', 'New Orleans Bowl', 'Cure Bowl', 'Gasparilla Bowl']) {
  const bowl = REGULAR_BOWLS.find(b => b.name === name);
  describeGame(bowl.record, name);
}

console.log('\n=== Native CFP First Round slots (924-927) ===');
for (const idx of [924, 925, 926, 927]) {
  describeGame(idx, `Native slot`);
}

console.log('\n=== A few real, ordinary (non-playoff) bowl games for comparison ===');
for (const idx of [370, 371].map(() => null)) {} // placeholder, using known regular bowls instead
for (const name of ['Alamo Bowl', 'Birmingham Bowl']) {
  const bowl = REGULAR_BOWLS.find(b => b.name === name);
  if (bowl) describeGame(bowl.record, name);
  else console.log(`${name}: not found in REGULAR_BOWLS list`);
}
