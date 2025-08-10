export const teamLogos: Record<string, string> = {
  Adelaide: '/logos/Adelaide.svg',
  Brisbane: '/logos/Brisbane.svg',
  Carlton: '/logos/Carlton.svg',
  Collingwood: '/logos/Collingwood.svg',
  Essendon: '/logos/Essendon.svg',
  Fremantle: '/logos/Fremantle.svg',
  GWS: '/logos/GWS.svg',
  Geelong: '/logos/Geelong.svg',
  'Gold Coast': '/logos/Gold Coast.svg',
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

export const fallbackLogo = '/logos/fallback.svg';

export const getTeamLogo = (team: string): string => {
  return teamLogos[team] || fallbackLogo;
};

export default teamLogos;
