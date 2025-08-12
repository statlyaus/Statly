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
  const abbreviations: Record<string, string> = {
    Adelaide: 'ADL',
    Brisbane: 'BRI', 
    Carlton: 'CAR',
    Collingwood: 'COL',
    Essendon: 'ESS',
    Fremantle: 'FRE',
    Geelong: 'GEE',
    'Gold Coast': 'GC',
    GWS: 'GWS',
    'GWS Giants': 'GWS',
    Hawthorn: 'HAW',
    Melbourne: 'MEL',
    'North Melbourne': 'NM',
    'Port Adelaide': 'PA',
    Richmond: 'RIC',
    'St Kilda': 'STK',
    Sydney: 'SYD',
    'West Coast': 'WC',
    'Western Bulldogs': 'WBD',
  };
  
  return abbreviations[teamName] || teamName.substring(0, 3).toUpperCase();
}

export default teamLogos;
