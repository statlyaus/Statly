const TEAM_ALIASES: Record<string, string> = {
  ade: 'Adelaide',
  adelaide: 'Adelaide',
  'adelaide crows': 'Adelaide',
  bri: 'Brisbane',
  bl: 'Brisbane',
  brisbane: 'Brisbane',
  'brisbane lions': 'Brisbane',
  bul: 'Western Bulldogs',
  gws: 'GWS',
  'gws giants': 'GWS',
  'greater western sydney giants': 'GWS',
  'greater western sydney': 'GWS',
  car: 'Carlton',
  carlton: 'Carlton',
  'carlton blues': 'Carlton',
  col: 'Collingwood',
  collingwood: 'Collingwood',
  'collingwood magpies': 'Collingwood',
  ess: 'Essendon',
  essendon: 'Essendon',
  'essendon bombers': 'Essendon',
  fre: 'Fremantle',
  fremantle: 'Fremantle',
  'fremantle dockers': 'Fremantle',
  gee: 'Geelong',
  geelong: 'Geelong',
  'geelong cats': 'Geelong',
  gcs: 'Gold Coast',
  'gold coast': 'Gold Coast',
  'gold coast suns': 'Gold Coast',
  haw: 'Hawthorn',
  hawthorn: 'Hawthorn',
  'hawthorn hawks': 'Hawthorn',
  mel: 'Melbourne',
  melbourne: 'Melbourne',
  'melbourne demons': 'Melbourne',
  nor: 'North Melbourne',
  'north melbourne': 'North Melbourne',
  'north melbourne kangaroos': 'North Melbourne',
  por: 'Port Adelaide',
  'port adelaide': 'Port Adelaide',
  'port adelaide power': 'Port Adelaide',
  ric: 'Richmond',
  richmond: 'Richmond',
  'richmond tigers': 'Richmond',
  stk: 'St Kilda',
  'st kilda': 'St Kilda',
  'st kilda saints': 'St Kilda',
  syd: 'Sydney',
  sydney: 'Sydney',
  'sydney swans': 'Sydney',
  wce: 'West Coast',
  wb: 'Western Bulldogs',
  bulldogs: 'Western Bulldogs',
  'western bulldogs': 'Western Bulldogs',
  footscray: 'Western Bulldogs',
  wc: 'West Coast',
  'west coast': 'West Coast',
  'west coast eagles': 'West Coast',
};

export function normalizeTeamName(raw: string): string {
  const key = (raw || '')
    .trim()
    .toLowerCase()
    .replace(/^(vs|v|at)\s+/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+fc$/i, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
  if (!key) return '';
  const alias = TEAM_ALIASES[key];
  if (alias) return alias;
  return raw.trim().replace(/^(vs|v|at)\s+/i, '').replace(/\s*\([^)]*\)\s*$/, '');
}

export const teamLogos: Record<string, string> = {
  Adelaide: '/logos/Adelaide.svg',
  Brisbane: '/logos/Brisbane.svg',
  Carlton: '/logos/Carlton.svg',
  Collingwood: '/logos/Collingwood.svg',
  Essendon: '/logos/Essendon.svg',
  Fremantle: '/logos/Fremantle.svg',
  Geelong: '/logos/Geelong.svg',
  'Gold Coast': '/logos/Gold Coast.svg',
  GWS: '/logos/GWS.svg',
  'GWS Giants': '/logos/GWS.svg', // alias
  Hawthorn: '/logos/Hawthorn.svg',
  Melbourne: '/logos/Melbourne.svg',
  'North Melbourne': '/logos/North Melbourne.svg',
  'Port Adelaide': '/logos/Port Adelaide.svg',
  Richmond: '/logos/Richmond.svg',
  'St Kilda': '/logos/St Kilda.svg',
  Sydney: '/logos/Sydney.svg',
  'West Coast': '/logos/West Coast.svg',
  'Western Bulldogs': '/logos/Western Bulldogs.svg',
};

const TEAM_BY_ABBR: Record<string, keyof typeof teamLogos> = {
  ADE: 'Adelaide',
  BRI: 'Brisbane',
  CAR: 'Carlton',
  COL: 'Collingwood',
  ESS: 'Essendon',
  FRE: 'Fremantle',
  GEE: 'Geelong',
  GCS: 'Gold Coast',
  GWS: 'GWS',
  HAW: 'Hawthorn',
  MEL: 'Melbourne',
  NOR: 'North Melbourne',
  POR: 'Port Adelaide',
  RIC: 'Richmond',
  STK: 'St Kilda',
  SYD: 'Sydney',
  WCE: 'West Coast',
  BUL: 'Western Bulldogs',
};

/**
 * Get team logo path with fallback
 */
export function getTeamLogo(teamName: string): string {
  const normalized = normalizeTeamName(teamName);
  const logo = teamLogos[normalized];
  if (logo) return logo;

  // Fallback: resolve through known AFL abbreviations
  const abbr = getTeamAbbreviation(normalized);
  const canonicalTeam = TEAM_BY_ABBR[abbr];
  if (canonicalTeam && teamLogos[canonicalTeam]) {
    return teamLogos[canonicalTeam];
  }

  // Fallback to a generic logo
  return '/logos/fallback.svg';
}

/**
 * Get team abbreviation for display
 */
export function getTeamAbbreviation(teamName: string): string {
  const normalized = normalizeTeamName(teamName)
    .replace(/\./g, '')
    .toLowerCase();
  const abbreviations: Record<string, string> = {
    adelaide: 'ADE',
    'adelaide crows': 'ADE',
    brisbane: 'BRI',
    'brisbane lions': 'BRI',
    bulldogs: 'BUL',
    'western bulldogs': 'BUL',
    carlton: 'CAR',
    'carlton blues': 'CAR',
    collingwood: 'COL',
    'collingwood magpies': 'COL',
    essendon: 'ESS',
    'essendon bombers': 'ESS',
    fremantle: 'FRE',
    'fremantle dockers': 'FRE',
    geelong: 'GEE',
    'geelong cats': 'GEE',
    'gold coast': 'GCS',
    'gold coast suns': 'GCS',
    gws: 'GWS',
    'gws giants': 'GWS',
    'greater western sydney giants': 'GWS',
    hawthorn: 'HAW',
    'hawthorn hawks': 'HAW',
    melbourne: 'MEL',
    'melbourne demons': 'MEL',
    'north melbourne': 'NOR',
    'north melbourne kangaroos': 'NOR',
    'port adelaide': 'POR',
    'port adelaide power': 'POR',
    richmond: 'RIC',
    'richmond tigers': 'RIC',
    'st kilda': 'STK',
    'st kilda saints': 'STK',
    'st kilda saints fc': 'STK',
    sydney: 'SYD',
    'sydney swans': 'SYD',
    'west coast': 'WCE',
    'west coast eagles': 'WCE',
  };

  if (abbreviations[normalized]) return abbreviations[normalized];
  const fallback = (teamName || '').substring(0, 3).toUpperCase();
  return fallback || teamName;
}

export default teamLogos;
