// Read-only diagnostic - does NOT modify the save.
//
//   node check-team-stadiums.mjs "path\to\save"
//
// Properly decodes the raw binary reference strings from the previous
// scan (converting to integers and using the same decodeRef the rest
// of the tool already trusts, instead of hand-parsing bits), then:
//   1. Confirms team names for a few known Week 17 games.
//   2. Reads each team's OWN permanent Stadium field directly off the
//      Team table - this should always be populated, regardless of
//      whether any specific game's Stadium field is.
//   3. Compares a repurposed bowl's game-level Stadium against its
//      home team's own permanent Stadium, to see if they already
//      match or genuinely differ.
import path from 'path';
import Franchise from 'madden-franchise';
import { decodeRef, TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node check-team-stadiums.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

const seasonMatches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = seasonMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

const teamMatches = franchise.tables.filter(t => t.header.uniqueId === TEAM_TABLE_ID);
const teamTable = teamMatches.length
  ? teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a))
  : franchise.tables.filter(t => t.header.tableId === TEAM_TABLE_ID)[0];
await teamTable.readRecords();

function decodeBinaryStringRef(binStr) {
  if (!binStr || typeof binStr !== 'string') return null;
  const asInt = parseInt(binStr, 2);
  return decodeRef(asInt);
}

// A handful of real Week 17 games to check, mixing what looked like
// native CFP slots (924-927, all currently unset) with the other
// Week 17 games (370-397) that already have real Stadium values -
// we don't yet know if 370-397 are neutral-site bowls or campus
// games, so print the team names to find out.
const recordsToCheck = [370, 371, 924, 925];

for (const i of recordsToCheck) {
  const rec = seasonTable.records[i];
  if (!rec) { console.log(`Record ${i}: no record`); continue; }
  const homeRefDecoded = decodeBinaryStringRef(rec['HomeTeam']);
  const awayRefDecoded = decodeBinaryStringRef(rec['AwayTeam']);
  const stadiumRefDecoded = decodeBinaryStringRef(rec['Stadium']);

  const homeName = homeRefDecoded ? rowToName(homeRefDecoded.row) : '(none)';
  const awayName = awayRefDecoded ? rowToName(awayRefDecoded.row) : '(none)';

  console.log(`Record ${i}: ${awayName} @ ${homeName}`);
  console.log(`  Game's Stadium decoded: ${JSON.stringify(stadiumRefDecoded)}`);

  // Now read the home team's OWN permanent Stadium field directly.
  if (homeRefDecoded) {
    const homeTeamRec = teamTable.records[homeRefDecoded.row];
    let ownStadiumRaw = null, ownStadiumDecoded = null;
    try {
      ownStadiumRaw = homeTeamRec['Stadium'];
      ownStadiumDecoded = decodeBinaryStringRef(ownStadiumRaw);
    } catch (e) {
      console.log(`  Could not read home team's own Stadium field: ${e.message}`);
    }
    console.log(`  Home team's OWN permanent Stadium decoded: ${JSON.stringify(ownStadiumDecoded)}`);
    if (stadiumRefDecoded && ownStadiumDecoded) {
      const match = stadiumRefDecoded.tableId === ownStadiumDecoded.tableId && stadiumRefDecoded.row === ownStadiumDecoded.row;
      console.log(`  MATCH: ${match}`);
    }
  }
  console.log('');
}
