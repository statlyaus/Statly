const normalizeKey = (k: string) => {
  // lower, trim, unify spaces and dots, keep some punctuation for matching
  const cleaned = k
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // Exact map for Footywire + common labels -> UI camelCase keys
  const map: Record<string, string> = {
    // --- identity / context (kept if you want them later) ---
    'player': 'name',
    'team': 'team',
    'club': 'team',
    'opposition': 'opposition',
    'season': 'season',
    'round': 'round',
    'round number': 'round',
    'match_id': 'matchId',
    'venue': 'venue',
    'date': 'date',
    'status': 'status',

    // --- core stats expected by UI ---
    'k': 'kicks',
    'hb': 'handballs',
    'm': 'marks',
    't': 'tackles',
    'g': 'goals',
    'ho': 'hitouts',
    'cl': 'clearances',
    'i50': 'inside50s',
    'inside 50s': 'inside50s',
    'r50': 'rebound50s',
    'rebound 50s': 'rebound50s',
    'ga': 'goalAssists',
    'goal assists': 'goalAssists',
    'tog': 'timeOnGroundPct',
    'time on ground': 'timeOnGroundPct',
    'time on ground %': 'timeOnGroundPct',
    'time on ground pct': 'timeOnGroundPct',
    'cp': 'contestedPossessions',
    'contested possessions': 'contestedPossessions',
    'up': 'uncontestedPossessions',
    'uncontested possessions': 'uncontestedPossessions',
    'ff': 'freesFor',
    'frees for': 'freesFor',
    'fa': 'freesAgainst',
    'frees against': 'freesAgainst',
    'one.percenters': 'onePercenters',
    'one percenters': 'onePercenters',
    'd': 'disposals',
    'disposals': 'disposals',

    // --- useful extras from Footywire ---
    'de': 'disposalEfficiency',          // %
    'ed': 'effectiveDisposals',
    'bo': 'bounces',
    'cm': 'contestedMarks',
    'mi5': 'marksInside50',
    'af': 'aflFantasy',                  // AF points
    'sc': 'supercoach',                  // SC points
    'ccl': 'centreClearances',
    'scl': 'stoppageClearances',
    'si': 'scoreInvolvements',
    'mg': 'metresGained',
    'to': 'turnovers',
    'itc': 'intercepts',
    't5': 'tacklesInside50',
    'cg': 'corridorGains',               // if present in your feed
    // keep anything else generic-camelCase as a fallback
  };

  if (map[cleaned]) return map[cleaned];

  // Generic fallback: strip punctuation then camelCase spaces
  const generic = cleaned
    .replace(/[%.()]/g, '')
    .replace(/\s+([a-z0-9])/g, (_, c) => c.toUpperCase());
  return generic;
};