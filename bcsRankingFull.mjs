import { readMatchup, readRecordBits, TEAM_TABLE_ID, SEASON_WEEK_BIT, WINNER_BIT, normalizeSeasonWeek } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

/**
 * Scan the SeasonGame table once and build a detailed per-team game log:
 * every completed game (week 0-15, using the validated winner-bit), who it
 * was against, what week, home or away, and win or loss. This is the single
 * source of truth every ranking system below is built from - fully
 * independent of any in-game "rank" field.
 */
function computeGameLogs(buf, recordsStart, recordSize, recordCount) {
  const logs = {}; // row -> [{ opponent, week, isHome, won }]
  const ensure = (row) => (logs[row] = logs[row] || []);

  const games = [];
  for (let i = 0; i < recordCount; i++) {
    const m = readMatchup(buf, recordsStart, recordSize, i);
    if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) continue;
    const recStart = recordsStart + i * recordSize;
    const recordBuf = buf.subarray(recStart, recStart + recordSize);
    const rawWeek = readRecordBits(recordBuf, SEASON_WEEK_BIT, 5);
    const week = normalizeSeasonWeek(rawWeek);
    if (week === null || week > 15) continue;
    const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
    games.push({ week, home: m.home.row, away: m.away.row, homeWon: winnerBit === 0 });
  }
  games.sort((a, b) => a.week - b.week); // chronological order, needed for Elo

  for (const g of games) {
    ensure(g.home).push({ opponent: g.away, week: g.week, isHome: true, won: g.homeWon });
    ensure(g.away).push({ opponent: g.home, week: g.week, isHome: false, won: !g.homeWon });
  }
  return { logs, games };
}

function winPctOf(logs, row) {
  const games = logs[row] || [];
  if (games.length === 0) return 0;
  return games.filter(g => g.won).length / games.length;
}

// ---------- Computer ranking systems (6) ----------

/** RPI: default 25% own win%, 50% opponents' win%, 25% opponents' opponents' win% */
function computeRPI(logs, params = { wp: 0.25, owp: 0.50, oowp: 0.25 }) {
  const rows = Object.keys(logs).map(Number);
  const wp = {};
  rows.forEach(r => { wp[r] = winPctOf(logs, r); });

  const owp = {};
  rows.forEach(r => {
    const opponents = logs[r].map(g => g.opponent);
    owp[r] = opponents.length ? opponents.reduce((s, o) => s + wp[o], 0) / opponents.length : 0;
  });

  const oowp = {};
  rows.forEach(r => {
    const opponents = logs[r].map(g => g.opponent);
    oowp[r] = opponents.length ? opponents.reduce((s, o) => s + (owp[o] ?? wp[o]), 0) / opponents.length : 0;
  });

  const total = params.wp + params.owp + params.oowp || 1;
  const rpi = {};
  rows.forEach(r => { rpi[r] = (params.wp * wp[r] + params.owp * owp[r] + params.oowp * oowp[r]) / total; });
  return rpi;
}

/** Strength of Schedule: default (2*OWP + OOWP) / 3, the standard NCAA formula */
function computeSOS(logs, params = { owp: 2, oowp: 1 }) {
  const rows = Object.keys(logs).map(Number);
  const wp = {};
  rows.forEach(r => { wp[r] = winPctOf(logs, r); });

  const owp = {};
  rows.forEach(r => {
    const opponents = logs[r].map(g => g.opponent);
    owp[r] = opponents.length ? opponents.reduce((s, o) => s + wp[o], 0) / opponents.length : 0;
  });

  const oowp = {};
  rows.forEach(r => {
    const opponents = logs[r].map(g => g.opponent);
    oowp[r] = opponents.length ? opponents.reduce((s, o) => s + (owp[o] ?? wp[o]), 0) / opponents.length : 0;
  });

  const total = params.owp + params.oowp || 1;
  const sos = {};
  rows.forEach(r => { sos[r] = (params.owp * owp[r] + params.oowp * oowp[r]) / total; });
  return sos;
}

/**
 * Colley Matrix: solves a system of linear equations from wins/losses only
 * (no scores needed). r_i = (1 + (wins_i - losses_i)/2 + sum(r_j for
 * opponents j)) / (2 + games_i). Solved via Gauss-Seidel iteration, which
 * converges reliably for this kind of diagonally-dominant system.
 */
function computeColley(logs) {
  const rows = Object.keys(logs).map(Number);
  const rating = {};
  rows.forEach(r => { rating[r] = 1.0; }); // start at neutral

  const opponentCounts = {}; // row -> { opponentRow: count }
  const wins = {}, losses = {}, games = {};
  rows.forEach(r => {
    opponentCounts[r] = {};
    wins[r] = logs[r].filter(g => g.won).length;
    losses[r] = logs[r].filter(g => !g.won).length;
    games[r] = logs[r].length;
    for (const g of logs[r]) {
      opponentCounts[r][g.opponent] = (opponentCounts[r][g.opponent] || 0) + 1;
    }
  });

  // Gauss-Seidel iteration to convergence
  for (let iter = 0; iter < 100; iter++) {
    let maxDelta = 0;
    for (const r of rows) {
      let oppSum = 0;
      for (const [oppRow, count] of Object.entries(opponentCounts[r])) {
        oppSum += count * (rating[oppRow] ?? 1.0);
      }
      const newRating = (1 + (wins[r] - losses[r]) / 2 + oppSum) / (2 + games[r]);
      maxDelta = Math.max(maxDelta, Math.abs(newRating - rating[r]));
      rating[r] = newRating;
    }
    if (maxDelta < 1e-6) break;
  }
  return rating;
}

/**
 * Simplified Massey: the real system uses point-margin, which we don't
 * have (no score field cracked); this variant uses win/loss (+1/-1) per
 * game as a stand-in for margin, solved the same least-squares way.
 * Also via Gauss-Seidel for the same reason as Colley.
 */
function computeMasseySimplified(logs) {
  const rows = Object.keys(logs).map(Number);
  const rating = {};
  rows.forEach(r => { rating[r] = 0.0; });

  const opponentCounts = {};
  const netResult = {}; // sum of +1/-1 across all games for team r
  rows.forEach(r => {
    opponentCounts[r] = {};
    netResult[r] = logs[r].reduce((s, g) => s + (g.won ? 1 : -1), 0);
    for (const g of logs[r]) {
      opponentCounts[r][g.opponent] = (opponentCounts[r][g.opponent] || 0) + 1;
    }
  });

  for (let iter = 0; iter < 100; iter++) {
    let maxDelta = 0;
    for (const r of rows) {
      const games = logs[r].length;
      if (games === 0) continue;
      let oppSum = 0;
      for (const [oppRow, count] of Object.entries(opponentCounts[r])) {
        oppSum += count * (rating[oppRow] ?? 0.0);
      }
      const newRating = (netResult[r] + oppSum) / games;
      maxDelta = Math.max(maxDelta, Math.abs(newRating - rating[r]));
      rating[r] = newRating;
    }
    if (maxDelta < 1e-6) break;
  }
  // Recenter so the average rating is 0 (Massey convention)
  const avg = rows.reduce((s, r) => s + rating[r], 0) / rows.length;
  rows.forEach(r => { rating[r] -= avg; });
  return rating;
}

/**
 * Elo: standard iterative rating, processed in chronological week order.
 *
 * No home-field advantage term - originally included a flat Elo-point
 * bump for whichever team was flagged "home" for a game, but that
 * depends on the same game's-own home/away flag we found inverted for
 * games we write ourselves (bracket slots). Whether that inversion also
 * applies to regular-season games the game simulates itself is
 * unverified, so rather than risk a silently-backwards adjustment
 * affecting real ratings, it was cut until that can be confirmed.
 */
function computeElo(logs, games, K = 24) {
  const rows = Object.keys(logs).map(Number);
  const rating = {};
  rows.forEach(r => { rating[r] = 1500; });

  for (const g of games) {
    const rHome = rating[g.home] ?? 1500;
    const rAway = rating[g.away] ?? 1500;
    const expectedHome = 1 / (1 + Math.pow(10, (rAway - rHome) / 400));
    const actualHome = g.homeWon ? 1 : 0;
    const delta = K * (actualHome - expectedHome);
    rating[g.home] = rHome + delta;
    rating[g.away] = rAway - delta;
  }
  return rating;
}

/**
 * Wins Above Average: wins minus the expected win total of a hypothetical
 * .500 team against the same schedule (approximated as sum of opponents'
 * loss percentages).
 */
function computeWinsAboveAverage(logs) {
  const rows = Object.keys(logs).map(Number);
  const wp = {};
  rows.forEach(r => { wp[r] = winPctOf(logs, r); });

  const waa = {};
  rows.forEach(r => {
    const actualWins = logs[r].filter(g => g.won).length;
    const expectedWinsForAverageTeam = logs[r].reduce((s, g) => s + (1 - wp[g.opponent]), 0);
    waa[r] = actualWins - expectedWinsForAverageTeam;
  });
  return waa;
}

// ---------- Simulated human poll (Poll Average) ----------

/** Longest current streak at end of season: positive = win streak, negative = loss streak */
function computeStreak(games) {
  let streak = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    if (i === games.length - 1) { streak = games[i].won ? 1 : -1; continue; }
    const sameDirection = games[i].won === games[games.length - 1].won;
    if (!sameDirection) break;
    streak += games[i].won ? 1 : -1;
  }
  return streak;
}

function normalize(valuesByRow) {
  const rows = Object.keys(valuesByRow).map(Number);
  const vals = rows.map(r => valuesByRow[r]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const out = {};
  rows.forEach(r => { out[r] = (valuesByRow[r] - min) / range; });
  return out;
}

const DEFAULT_POWER_CONFERENCES = ['SEC', 'Big Ten', 'ACC', 'Big 12', 'Pac-12'];

/**
 * Simulates a human poll (AP/Coaches-style) using computable metrics only:
 * win%, SOS, quality wins, streak, ranked win/bad loss bonuses, conference
 * championship bonus, and preseason inertia for power-conference programs.
 * This mirrors the same philosophy as the original CFB14 tool this is
 * modeled on - simulate the poll from real performance metrics rather than
 * trust an in-game field.
 *
 * Road win bonus and home loss penalty were removed - they depended on the
 * game's home/away flag, which we since found is inverted for games we
 * write ourselves (bracket slots). Whether that inversion also applies to
 * regular-season games the game simulates itself is unverified, so rather
 * than risk a silently-backwards factor affecting real rankings, both were
 * cut until that can be confirmed.
 *
 * `computerRank` is a row->rank map (1 = best) derived from the computer
 * average ONLY (never the poll itself), so "ranked opponent" bonuses/
 * penalties don't create a circular dependency on the poll we're building.
 */
function computePollAverage(logs, sos, confChampions, weights = {}, computerRank = {}, powerConferences = DEFAULT_POWER_CONFERENCES, teamConference = {}) {
  const {
    winPct = 0.50,
    sos: sosWeight = 0.30,
    qualityWins = 0.15,
    confChampBonus = 0.05,
    rankedWinBonus = 0.05,
    rankedWinCutoff = 25,
    winStreakBonus = 0.05,
    streakLength = 4,
    badLossPenalty = 0.10,
    badLossThreshold = 75,
    preseasonBonus = 0.04,
  } = weights;

  const rows = Object.keys(logs).map(Number);
  const wp = {};
  rows.forEach(r => { wp[r] = winPctOf(logs, r); });

  const qualityWinsRaw = {};
  rows.forEach(r => {
    const games = logs[r];
    qualityWinsRaw[r] = games.filter(g => g.won).reduce((s, g) => s + wp[g.opponent], 0);
  });
  const normQuality = normalize(qualityWinsRaw);

  const champSet = new Set(Object.values(confChampions || {}));

  const pollScore = {};
  rows.forEach(r => {
    const games = logs[r];
    const name = rowToName(r);

    const isChamp = champSet.has(name) ? 1 : 0;
    const rankedWins = games.filter(g => g.won && (computerRank[g.opponent] ?? Infinity) <= rankedWinCutoff).length;
    const streak = computeStreak(games);
    const streakBonus = streak >= streakLength ? 1 : 0;
    const badLosses = games.filter(g => !g.won && (computerRank[g.opponent] ?? 0) > badLossThreshold).length;
    const isPowerConf = powerConferences.includes(teamConference[name]) ? 1 : 0;

    pollScore[r] =
      winPct * wp[r] +
      sosWeight * (sos[r] || 0) +
      qualityWins * normQuality[r] +
      confChampBonus * isChamp +
      rankedWinBonus * rankedWins +
      winStreakBonus * streakBonus +
      preseasonBonus * isPowerConf -
      badLossPenalty * badLosses;
  });
  return pollScore;
}

// ---------- Combine everything ----------

/**
 * Full BCS-inspired composite: 50% simulated Poll Average, 50% Computer
 * Average (6 systems, highest + lowest dropped per team by default, or a
 * straight weighted blend if you want to emphasize specific systems - e.g.
 * weighting Colley Matrix more heavily, same idea as the CFB14 tool this
 * is based on). Includes a dynamic conference-SOS adjustment and a
 * head-to-head tiebreaker for very close scores.
 */
function computeFullBCSRankings(buf, recordsStart, recordSize, recordCount, confChampions, options = {}) {
  const {
    pollWeight = 0.5,
    computerWeight = 0.5,
    dropHighLowPerTeam = true,
    computerWeights = { rpi: 1, colley: 1, massey: 1, elo: 1, sos: 1, waa: 1 },
    conferenceSosAdjustment = true,
    confSosWeight = 0.08,
    rpiParams = { wp: 0.25, owp: 0.50, oowp: 0.25 },
    sosParams = { owp: 2, oowp: 1 },
    eloK = 32,
    pollWeights = {},
    powerConferences = DEFAULT_POWER_CONFERENCES,
    teamConference = {},
  } = options;

  const { logs, games } = computeGameLogs(buf, recordsStart, recordSize, recordCount);
  const rows = Object.keys(logs).map(Number);

  const rpi = computeRPI(logs, rpiParams);
  const colley = computeColley(logs);
  const massey = computeMasseySimplified(logs);
  const elo = computeElo(logs, games, eloK);
  const sos = computeSOS(logs, sosParams);
  const waa = computeWinsAboveAverage(logs);

  const normRpi = normalize(rpi);
  const normColley = normalize(colley);
  const normMassey = normalize(massey);
  const normElo = normalize(elo);
  const normSos = normalize(sos);
  const normWaa = normalize(waa);

  const systems = [
    { key: 'rpi', values: normRpi, weight: computerWeights.rpi },
    { key: 'colley', values: normColley, weight: computerWeights.colley },
    { key: 'massey', values: normMassey, weight: computerWeights.massey },
    { key: 'elo', values: normElo, weight: computerWeights.elo },
    { key: 'sos', values: normSos, weight: computerWeights.sos },
    { key: 'waa', values: normWaa, weight: computerWeights.waa },
  ];

  const computerScore = {};
  rows.forEach(r => {
    const perSystem = systems.map(s => ({ key: s.key, value: s.values[r], weight: s.weight }));
    let kept = perSystem;
    if (dropHighLowPerTeam && perSystem.length > 2) {
      const sorted = [...perSystem].sort((a, b) => a.value - b.value);
      const withoutLowest = sorted.slice(1);
      const withoutHighest = withoutLowest.slice(0, -1);
      kept = withoutHighest;
    }
    const totalWeight = kept.reduce((s, k) => s + k.weight, 0) || 1;
    computerScore[r] = kept.reduce((s, k) => s + k.value * k.weight, 0) / totalWeight;
  });

  // Preliminary computer-only rank (1 = best), used purely so the poll
  // simulation below has a non-circular notion of "ranked opponent" for
  // the ranked-win bonus / bad-loss penalty - it never looks at the poll
  // score itself, only the computer average.
  const computerRank = {};
  [...rows].sort((a, b) => computerScore[b] - computerScore[a]).forEach((r, i) => { computerRank[r] = i + 1; });

  const pollScore = computePollAverage(logs, sos, confChampions, pollWeights, computerRank, powerConferences, teamConference);
  const normPoll = normalize(pollScore);

  // Dynamic conference SOS adjustment: teams in conferences with a higher
  // average SOS get a small proportional boost, rewarding tough schedules
  // at the conference level, not just individually.
  let confSosBoost = {};
  if (conferenceSosAdjustment) {
    const confSosTotals = {}, confSosCounts = {};
    rows.forEach(r => {
      const conf = teamConference[rowToName(r)];
      if (!conf) return;
      confSosTotals[conf] = (confSosTotals[conf] || 0) + (sos[r] || 0);
      confSosCounts[conf] = (confSosCounts[conf] || 0) + 1;
    });
    const confAvgSos = {};
    for (const conf of Object.keys(confSosTotals)) confAvgSos[conf] = confSosTotals[conf] / confSosCounts[conf];
    const normConfSos = normalize(confAvgSos);
    rows.forEach(r => {
      const conf = teamConference[rowToName(r)];
      confSosBoost[r] = conf ? (normConfSos[conf] || 0) * confSosWeight : 0;
    });
  } else {
    rows.forEach(r => { confSosBoost[r] = 0; });
  }

  const champSet = new Set(Object.values(confChampions || {}));

  const results = rows
    .filter(r => !rowToName(r).startsWith('UNKNOWN_PLACEHOLDER')) // generic FCS scheduling filler, not real teams
    .map(r => {
      const wins = logs[r].filter(g => g.won).length;
      const losses = logs[r].filter(g => !g.won).length;
      const bcsScore = pollWeight * normPoll[r] + computerWeight * computerScore[r] + confSosBoost[r];
      const name = rowToName(r);
      return {
        row: r,
        name,
        isConferenceChampion: champSet.has(name),
        wins, losses,
        pollScore: Math.round(normPoll[r] * 1000) / 1000,
        computerScore: Math.round(computerScore[r] * 1000) / 1000,
        confSosBoost: Math.round(confSosBoost[r] * 1000) / 1000,
        bcsScore: Math.round(bcsScore * 1000) / 1000,
        breakdown: {
          rpi: Math.round(normRpi[r] * 1000) / 1000,
          colley: Math.round(normColley[r] * 1000) / 1000,
          massey: Math.round(normMassey[r] * 1000) / 1000,
          elo: Math.round(elo[r]),
          sos: Math.round(normSos[r] * 1000) / 1000,
          waa: Math.round(normWaa[r] * 1000) / 1000,
        },
      };
    });

  results.sort((a, b) => b.bcsScore - a.bcsScore);

  // Head-to-head tiebreaker: if two adjacent teams are within 0.002 of
  // each other and played each other this season, the winner of that game
  // is placed ahead.
  for (let i = 0; i < results.length - 1; i++) {
    const a = results[i], b = results[i + 1];
    if (Math.abs(a.bcsScore - b.bcsScore) < 0.002) {
      const gameBetween = logs[a.row]?.find(g => g.opponent === b.row);
      if (gameBetween && !gameBetween.won) {
        results[i] = b; results[i + 1] = a; // b actually beat a - swap
      }
    }
  }

  results.forEach((r, i) => { r.bcsRank = i + 1; });
  return results;
}

export { computeGameLogs, computeFullBCSRankings, DEFAULT_POWER_CONFERENCES };
