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

const fallbackLogo = '/logos/fallback.svg';

type TeamDefinition = {
  name: string;
  logo: string;
  abbreviation: string;
  aliases: readonly string[];
};

const teams: readonly TeamDefinition[] = [
  {
    name: 'Adelaide',
    logo: teamLogos.Adelaide,
    abbreviation: 'ADL',
    aliases: ['Adelaide Crows', 'Crows', 'ADEL'],
  },
  {
    name: 'Brisbane',
    logo: teamLogos.Brisbane,
    abbreviation: 'BRI',
    aliases: ['Brisbane Lions', 'Lions', 'BL'],
  },
  {
    name: 'Carlton',
    logo: teamLogos.Carlton,
    abbreviation: 'CAR',
    aliases: ['Carlton Blues', 'Blues'],
  },
  {
    name: 'Collingwood',
    logo: teamLogos.Collingwood,
    abbreviation: 'COL',
    aliases: ['Collingwood Magpies', 'Magpies'],
  },
  {
    name: 'Essendon',
    logo: teamLogos.Essendon,
    abbreviation: 'ESS',
    aliases: ['Essendon Bombers', 'Bombers'],
  },
  {
    name: 'Fremantle',
    logo: teamLogos.Fremantle,
    abbreviation: 'FRE',
    aliases: ['Fremantle Dockers', 'Dockers'],
  },
  {
    name: 'Geelong',
    logo: teamLogos.Geelong,
    abbreviation: 'GEE',
    aliases: ['Geelong Cats', 'Cats', 'GEEL'],
  },
  {
    name: 'Gold Coast',
    logo: teamLogos['Gold Coast'],
    abbreviation: 'GC',
    aliases: ['Gold Coast Suns', 'Suns', 'GCS'],
  },
  {
    name: 'GWS',
    logo: teamLogos.GWS,
    abbreviation: 'GWS',
    aliases: ['GWS Giants', 'Greater Western Sydney', 'Greater Western Sydney Giants', 'Giants'],
  },
  {
    name: 'Hawthorn',
    logo: teamLogos.Hawthorn,
    abbreviation: 'HAW',
    aliases: ['Hawthorn Hawks', 'Hawks'],
  },
  {
    name: 'Melbourne',
    logo: teamLogos.Melbourne,
    abbreviation: 'MEL',
    aliases: ['Melbourne Demons', 'Demons', 'MELB'],
  },
  {
    name: 'North Melbourne',
    logo: teamLogos['North Melbourne'],
    abbreviation: 'NM',
    aliases: ['North Melbourne Kangaroos', 'Kangaroos', 'NTH'],
  },
  {
    name: 'Port Adelaide',
    logo: teamLogos['Port Adelaide'],
    abbreviation: 'PA',
    aliases: ['Port Adelaide Power', 'Power', 'PORT'],
  },
  {
    name: 'Richmond',
    logo: teamLogos.Richmond,
    abbreviation: 'RIC',
    aliases: ['Richmond Tigers', 'Tigers', 'RICH'],
  },
  {
    name: 'St Kilda',
    logo: teamLogos['St Kilda'],
    abbreviation: 'STK',
    aliases: ['St. Kilda', 'St Kilda Saints', 'Saints'],
  },
  {
    name: 'Sydney',
    logo: teamLogos.Sydney,
    abbreviation: 'SYD',
    aliases: ['Sydney Swans', 'Swans'],
  },
  {
    name: 'West Coast',
    logo: teamLogos['West Coast'],
    abbreviation: 'WC',
    aliases: ['West Coast Eagles', 'Eagles', 'WCE'],
  },
  {
    name: 'Western Bulldogs',
    logo: teamLogos['Western Bulldogs'],
    abbreviation: 'WBD',
    aliases: ['Bulldogs', 'Footscray', 'WB'],
  },
];

const normalizeTeamKey = (teamName: string): string =>
  teamName.trim().toUpperCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ');

const teamByNormalizedName = teams.reduce<Record<string, TeamDefinition>>((lookup, team) => {
  for (const alias of [team.name, team.abbreviation, ...team.aliases]) {
    lookup[normalizeTeamKey(alias)] = team;
  }

  return lookup;
}, {});

const getTeamDefinition = (teamName: string): TeamDefinition | undefined => {
  return teamByNormalizedName[normalizeTeamKey(teamName)];
};

/**
 * Get team logo path with fallback
 */
export function getTeamLogo(teamName: string): string {
  return getTeamDefinition(teamName)?.logo ?? fallbackLogo;
}

/**
 * Get team abbreviation for display
 */
export function getTeamAbbreviation(teamName: string): string {
  return getTeamDefinition(teamName)?.abbreviation ?? teamName.trim().substring(0, 3).toUpperCase();
}

/**
 * Get canonical team name for display
 */
export function getTeamName(teamName: string): string {
  return getTeamDefinition(teamName)?.name ?? teamName.trim();
}

export default teamLogos;
