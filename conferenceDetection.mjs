/**
 * Auto-detects conference groupings purely from schedule data - no hidden
 * "conference ID" field needed. Teams play their conference-mates far more
 * often than non-conference opponents, so a community-detection algorithm
 * on the "who played whom" graph recovers conference structure directly.
 *
 * Validated against a real save with a heavily scrambled custom realignment
 * (Notre Dame/Kentucky/Louisville in the Big Ten, FSU/Miami/UCF in the SEC,
 * etc.) - every team confirmed from real in-game standings screenshots
 * landed in exactly the right cluster.
 *
 * This is a single-pass greedy modularity optimization (the core of Louvain
 * phase 1, without the multi-level graph-contraction refinement phases).
 * For a graph with structure this clean - dense intra-conference edges,
 * sparse inter-conference edges - one pass is enough to recover the true
 * clusters; the refinement phases mainly help with noisier real-world graphs.
 */

/**
 * @param {[number, number][]} games - pairs of team rows that played each other
 * @param {number} attempts - number of randomized restarts to try, keeping the best-scoring partition
 * @returns {Map<number, number>} row -> community id
 */
function detectCommunities(games, attempts = 12) {
  const baseAdj = new Map();
  const addEdge = (map, a, b, w) => {
    if (!map.has(a)) map.set(a, new Map());
    map.get(a).set(b, (map.get(a).get(b) || 0) + w);
  };
  for (const [a, b] of games) {
    if (a === b) continue;
    addEdge(baseAdj, a, b, 1);
    addEdge(baseAdj, b, a, 1);
  }

  // No games at all (or every "game" was a same-team no-op) - nothing to
  // cluster. Return an empty result rather than crashing; the caller
  // should treat an empty map as "not enough data" and say so.
  if (baseAdj.size === 0) {
    return new Map();
  }

  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = runOnce(baseAdj, attempt);
    const score = modularity(baseAdj, result);
    // NaN comparisons are always false in JS, so an all-NaN run would
    // otherwise leave `best` as null forever - guard explicitly instead
    // of relying on `score > bestScore` alone.
    if (best === null || (!Number.isNaN(score) && score > bestScore)) {
      bestScore = Number.isNaN(score) ? bestScore : score;
      best = result;
    }
  }

  // Relabel by size descending, for stable output ordering.
  const groups = new Map();
  for (const [row, c] of best.entries()) {
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(row);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const relabeled = new Map();
  ordered.forEach(([, members], idx) => {
    members.forEach(row => relabeled.set(row, idx));
  });
  return relabeled;
}

/** Overall modularity Q of a full partition, computed on the original graph. */
function modularity(adj, partition) {
  let m2 = 0;
  const degree = new Map();
  for (const [n, neighbors] of adj.entries()) {
    let d = 0;
    for (const w of neighbors.values()) d += w;
    degree.set(n, d);
    m2 += d;
  }
  let q = 0;
  for (const [n, neighbors] of adj.entries()) {
    for (const [nb, w] of neighbors.entries()) {
      if (partition.get(n) === partition.get(nb)) {
        q += w - (degree.get(n) * degree.get(nb)) / m2;
      }
    }
  }
  return q / m2;
}

function runOnce(baseAdj, seed) {
  let nodeMembers = new Map([...baseAdj.keys()].map(n => [n, [n]]));
  let adj = baseAdj;

  let level = 0;
  const maxLevels = 20;

  while (level < maxLevels) {
    const { community, improved } = localMovingPhase(adj, seed + level);
    if (!improved) break;

    const { newAdj, newNodeMembers } = aggregate(adj, community, nodeMembers);
    if (newAdj.size >= adj.size) {
      adj = newAdj;
      nodeMembers = newNodeMembers;
      break;
    }
    adj = newAdj;
    nodeMembers = newNodeMembers;
    level++;
  }

  const result = new Map();
  let communityId = 0;
  for (const members of nodeMembers.values()) {
    for (const row of members) result.set(row, communityId);
    communityId++;
  }
  return result;
}

/** Simple deterministic pseudo-random shuffle (mulberry32), so each restart
 * explores a different node visitation order without needing a real RNG lib. */
function shuffled(array, seed) {
  let s = seed + 1;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** One pass of local-moving modularity optimization. Returns the resulting
 * node->community map and whether any node ever moved. */
function localMovingPhase(adj, seed = 0) {
  const nodes = shuffled([...adj.keys()], seed);
  const community = new Map(nodes.map(n => [n, n]));

  const degree = new Map();
  let m2 = 0;
  for (const n of nodes) {
    let d = 0;
    for (const w of adj.get(n).values()) d += w;
    degree.set(n, d);
    m2 += d;
  }
  const communityDegree = new Map(nodes.map(n => [n, degree.get(n)]));

  let improvedAny = false;
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 100) {
    improved = false;
    iterations++;
    for (const node of nodes) {
      const currentCommunity = community.get(node);
      communityDegree.set(currentCommunity, communityDegree.get(currentCommunity) - degree.get(node));

      const neighborCommunityWeight = new Map();
      for (const [neighbor, weight] of adj.get(node).entries()) {
        if (neighbor === node) continue;
        const c = community.get(neighbor);
        neighborCommunityWeight.set(c, (neighborCommunityWeight.get(c) || 0) + weight);
      }

      const ki = degree.get(node);
      let bestCommunity = currentCommunity;
      let bestGain = (neighborCommunityWeight.get(currentCommunity) || 0) - (communityDegree.get(currentCommunity) * ki) / m2;

      for (const [candidateCommunity, weight] of neighborCommunityWeight.entries()) {
        if (candidateCommunity === currentCommunity) continue;
        const sigmaTot = communityDegree.get(candidateCommunity) || 0;
        const gain = weight - (sigmaTot * ki) / m2;
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          bestCommunity = candidateCommunity;
        }
      }

      community.set(node, bestCommunity);
      communityDegree.set(bestCommunity, (communityDegree.get(bestCommunity) || 0) + degree.get(node));
      if (bestCommunity !== currentCommunity) { improved = true; improvedAny = true; }
    }
  }
  return { community, improved: improvedAny };
}

/** Collapse the graph so each community becomes a single node. Self-loops
 * (intra-community edges) are tracked implicitly via community-internal
 * weight and folded into that node's future degree correctly because we
 * sum ALL edge weights (including a node's own community's edges) when
 * building the aggregated adjacency. */
function aggregate(adj, community, nodeMembers) {
  const newAdj = new Map();
  const newNodeMembers = new Map();

  for (const node of adj.keys()) {
    const c = community.get(node);
    if (!newNodeMembers.has(c)) newNodeMembers.set(c, []);
    newNodeMembers.get(c).push(...nodeMembers.get(node));
  }

  for (const [node, neighbors] of adj.entries()) {
    const c1 = community.get(node);
    for (const [neighbor, weight] of neighbors.entries()) {
      const c2 = community.get(neighbor);
      if (!newAdj.has(c1)) newAdj.set(c1, new Map());
      newAdj.get(c1).set(c2, (newAdj.get(c1).get(c2) || 0) + weight);
    }
  }

  return { newAdj, newNodeMembers };
}

export { detectCommunities };
