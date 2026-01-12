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

/**
 * Get team logo path with fallback
 */
export function getTeamLogo(teamName: string): string {
  const logo = teamLogos[teamName];
  if (logo) return logo;

  // Fallback to a generic logo
  return '/logos/fallback.svg';
}

/**
 * Get team abbreviation for display
 */
export function getTeamAbbreviation(teamName: string): string {
  const normalized = (teamName || '')
    .trim()
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
