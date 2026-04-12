import { normalizeTeamName } from '@shared/player-identity/teamNames';

export { normalizeTeamName };

/**
 * Club marks in `public/logos/*.svg` — standard SVG 1.1 from Illustrator (embedded `<style>` / paths, no scripts).
 * Served as static files; `TeamLogo` sets `unoptimized` for `.svg` so Next Image does not rasterize them.
 */
export const teamLogos: Record<string, string> = {
  Adelaide: '/logos/Adelaide.svg',
  Brisbane: '/logos/Brisbane.svg',
  Carlton: '/logos/Carlton.svg',
  Collingwood: '/logos/Collingwood.svg',
  Essendon: '/logos/Essendon.svg',
  Fitzroy: '/logos/Fitzroy.svg',
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

/**
 * Every club with a mark under `public/logos/`, in stable order for hero strips (includes Fitzroy for historical trades).
 * Omits duplicate map keys such as `GWS Giants`.
 */
export const AFL_CLUB_LOGO_STRIP_ORDER: readonly string[] = [
  'Adelaide',
  'Brisbane',
  'Carlton',
  'Collingwood',
  'Essendon',
  'Fitzroy',
  'Fremantle',
  'Geelong',
  'Gold Coast',
  'GWS',
  'Hawthorn',
  'Melbourne',
  'North Melbourne',
  'Port Adelaide',
  'Richmond',
  'St Kilda',
  'Sydney',
  'West Coast',
  'Western Bulldogs',
];

const TEAM_BY_ABBR: Record<string, keyof typeof teamLogos> = {
  ADE: 'Adelaide',
  BRI: 'Brisbane',
  CAR: 'Carlton',
  COL: 'Collingwood',
  ESS: 'Essendon',
  FIT: 'Fitzroy',
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
  const normalized = normalizeTeamName(teamName).replace(/\./g, '').toLowerCase();
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
    fitzroy: 'FIT',
    'fitzroy fc': 'FIT',
    'fitzroy football club': 'FIT',
    'fitzroy lions': 'FIT',
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
