// Read-only diagnostic - does NOT modify the save file at all.
// Run from your project folder:
//
//   node check-12team-round1.mjs "path\to\your\current\12-team save"
//
import path from 'path';
import { openSave, readMatchup, readRecordBits, WINNER_BIT, TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';
import Franchise from 'madden-franchise';

const savePath = process.argv[2];
if (!savePath) {
  console.error('Usage: node check-12team-round1.mjs <path-to-save-file>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const SEASON_GAME_UNIQUE_ID = 4049338978;
const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

function dump(recordIndex, label) {
  const m = readMatchup(buf, recordsStart, recordSize, recordIndex);
  const home = m.home.tableId === TEAM_TABLE_ID ? rowToName(m.home.row) : '(not a team)';
  const away = m.away.tableId === TEAM_TABLE_ID ? rowToName(m.away.row) : '(not a team)';
  const recStart = recordsStart + recordIndex * recordSize;
  const recordBuf = buf.subarray(recStart, recStart + recordSize);
  const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
  let gameStatus = null, isSimmed = null, hasBeenPublished = null, seasonWeek = null;
  try { gameStatus = seasonTable.records[recordIndex]['GameStatus']; } catch { /* ignore */ }
  try { isSimmed = seasonTable.records[recordIndex]['IsSimmed']; } catch { /* ignore */ }
  try { hasBeenPublished = seasonTable.records[recordIndex]['HasBeenPublished']; } catch { /* ignore */ }
  try { seasonWeek = seasonTable.records[recordIndex]['SeasonWeek']; } catch { /* ignore */ }
  console.log(`Record ${recordIndex} (${label}): home=${home}  away=${away}  WINNER_BIT=${winnerBit}  GameStatus=${gameStatus}  IsSimmed=${isSimmed}  HasBeenPublished=${hasBeenPublished}  SeasonWeek=${seasonWeek}`);
}

console.log('=== Round 1 (5v12, 6v11, 7v10, 8v9) ===');
dump(924, 'game 1: 5v12');
dump(925, 'game 2: 6v11');
dump(926, 'game 3: 7v10');
dump(927, 'game 4: 8v9');

console.log('\n=== Quarterfinals / byes ===');
dump(928, 'QF slot 1');
dump(929, 'QF slot 2');
dump(930, 'QF slot 3');
dump(931, 'QF slot 4');
