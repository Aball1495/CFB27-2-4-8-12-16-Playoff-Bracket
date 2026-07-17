// Team -> conference mapping. Built from confirmed roster/conference data
// and corrected against real in-game Conference Championship results
// (Army and Navy confirmed Independent, not American, via a real save file
// this session).
//
// IMPORTANT: this is one specific dynasty's realignment (this project's).
// Anyone running a different realignment needs to override it - see
// teamConferenceOverrides.json next to this file. Anything listed there
// takes priority over the defaults below; anything not listed keeps its
// default. This file itself should not need editing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEAM_CONFERENCE_DEFAULTS = {
  'Air Force':'Mountain West','Akron':'MAC','Alabama':'SEC','Appalachian State':'Sun Belt','Arizona':'Big 12',
  'Arizona State':'Big 12','Arkansas':'SEC','Arkansas State':'Sun Belt','Army':'Independent','Auburn':'SEC',
  'Ball State':'MAC','Baylor':'Big 12','Boise State':'Pac-12','Boston College':'ACC','Bowling Green':'MAC',
  'Buffalo':'MAC','BYU':'Big 12','California':'ACC','Central Michigan':'MAC','Charlotte':'American',
  'Cincinnati':'Big 12','Clemson':'ACC','Coastal Carolina':'Sun Belt','Colorado':'Big 12','Colorado State':'Pac-12',
  'Delaware':'Conference USA','Duke':'ACC','East Carolina':'American','Eastern Michigan':'MAC','Florida International':'Conference USA',
  'Florida':'SEC','Florida Atlantic':'American','Florida State':'ACC','Fresno State':'Pac-12','Georgia':'SEC',
  'Georgia Southern':'Sun Belt','Georgia State':'Sun Belt','Georgia Tech':'ACC','Hawai\'i':'Mountain West','Houston':'Big 12',
  'Illinois':'Big Ten','Indiana':'Big Ten','Iowa':'Big Ten','Iowa State':'Big 12','Jacksonville State':'Conference USA',
  'James Madison':'Sun Belt','Kansas':'Big 12','Kansas State':'Big 12','Kennesaw State':'Conference USA','Kent State':'MAC',
  'Kentucky':'SEC','Liberty':'Conference USA','Louisiana':'Sun Belt','Louisiana Tech':'Sun Belt','Louisville':'ACC',
  'LSU':'SEC','Marshall':'Sun Belt','Maryland':'Big Ten','Memphis':'American','Miami':'ACC',
  'Miami University':'MAC','Michigan':'Big Ten','Michigan State':'Big Ten','Middle Tennessee':'Conference USA','Minnesota':'Big Ten',
  'Mississippi State':'SEC','Missouri':'SEC','Missouri State':'Conference USA','Navy':'Independent','NC State':'ACC',
  'Nebraska':'Big Ten','Nevada':'Mountain West','New Mexico':'Mountain West','New Mexico State':'Conference USA','North Carolina':'ACC',
  'North Dakota State':'Mountain West','Northern Illinois':'Mountain West','North Texas':'American','Northwestern':'Big Ten',
  'Ohio':'MAC','Ohio State':'Big Ten','Oklahoma':'SEC','Oklahoma State':'Big 12','Old Dominion':'Sun Belt',
  'Ole Miss':'SEC','Oregon':'Big Ten','Oregon State':'Pac-12','Penn State':'Big Ten','Pittsburgh':'ACC',
  'Purdue':'Big Ten','Rice':'American','Rutgers':'Big Ten','Sacramento State':'MAC','Sam Houston':'Conference USA',
  'San Diego State':'Pac-12','San Jose State':'Mountain West','SMU':'ACC','South Alabama':'Sun Belt','South Carolina':'SEC',
  'Southern Mississippi':'Sun Belt','USF':'American','Stanford':'ACC','Syracuse':'ACC','TCU':'Big 12',
  'Temple':'American','Tennessee':'SEC','Texas':'SEC','Texas A&M':'SEC','Texas State':'Pac-12',
  'Texas Tech':'Big 12','Toledo':'MAC','Troy':'Sun Belt','Tulane':'American','Tulsa':'American',
  'UAB':'American','UCF':'Big 12','UCLA':'Big Ten','UL Monroe':'Sun Belt','UMass':'MAC',
  'UNLV':'Mountain West','USC':'Big Ten','Utah':'Big 12','Utah State':'Pac-12',
  'UTEP':'Mountain West','UTSA':'American','Vanderbilt':'SEC','Virginia':'ACC','Virginia Tech':'ACC',
  'Wake Forest':'ACC','Washington':'Big Ten','Washington State':'Pac-12','Western Kentucky':'Conference USA',
  'Western Michigan':'MAC','West Virginia':'Big 12','Wisconsin':'Big Ten','Wyoming':'Mountain West',
};

const DEFAULT_ALL_CONFERENCES = [
  'SEC', 'Big Ten', 'Big 12', 'ACC', 'American', 'Mountain West', 'Pac-12', 'MAC', 'Sun Belt', 'Conference USA',
];

const overridesPath = path.join(__dirname, 'teamConferenceOverrides.json');

/**
 * Reads the overrides file fresh every call (not cached at module load),
 * so saving a new override - whether from the manual JSON edit flow or the
 * auto-detect/mismatch-check flow - takes effect on the very next save you
 * load, with no app restart required.
 */
function loadTeamConference() {
  let overrides = {};
  try {
    if (fs.existsSync(overridesPath)) {
      overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    }
  } catch (err) {
    console.error(`Failed to load teamConferenceOverrides.json (using defaults only): ${err.message}`);
  }

  const TEAM_CONFERENCE = { ...TEAM_CONFERENCE_DEFAULTS, ...overrides };
  const ALL_CONFERENCES = Array.from(new Set([...DEFAULT_ALL_CONFERENCES, ...Object.values(overrides)]));
  return { TEAM_CONFERENCE, ALL_CONFERENCES };
}

export { loadTeamConference, TEAM_CONFERENCE_DEFAULTS };
