export type TeamAbbr =
  | 'ADE'
  | 'BRL'
  | 'CAR'
  | 'COL'
  | 'ESS'
  | 'FRE'
  | 'GEE'
  | 'GCS'
  | 'GWS'
  | 'HAW'
  | 'MEL'
  | 'NTH'
  | 'PTA'
  | 'RIC'
  | 'STK'
  | 'SYD'
  | 'WCE'
  | 'WBD';

export interface TeamToken {
  name: string;
  abbr: TeamAbbr;
  primary: string;
  onPrimary: string;
  subtle: string; // light background
  onSubtle: string;
  border: string;
}

export const TEAM_TOKENS: Record<TeamAbbr, TeamToken> = {
  ADE: { name: 'Adelaide', abbr: 'ADE', primary: '#002B5C', onPrimary: '#FFFFFF', subtle: '#E6EEF7', onSubtle: '#0F2A45', border: '#B8C7DA' },
  BRL: { name: 'Brisbane Lions', abbr: 'BRL', primary: '#7C0D20', onPrimary: '#FFFFFF', subtle: '#F4E6EA', onSubtle: '#5B0A18', border: '#E2BFC8' },
  CAR: { name: 'Carlton', abbr: 'CAR', primary: '#001E3C', onPrimary: '#FFFFFF', subtle: '#E6ECF5', onSubtle: '#0E2743', border: '#C5D0E0' },
  COL: { name: 'Collingwood', abbr: 'COL', primary: '#111111', onPrimary: '#FFFFFF', subtle: '#F0F0F0', onSubtle: '#1F1F1F', border: '#D9D9D9' },
  ESS: { name: 'Essendon', abbr: 'ESS', primary: '#CC0000', onPrimary: '#FFFFFF', subtle: '#FBEAEA', onSubtle: '#720000', border: '#ECA9A9' },
  FRE: { name: 'Fremantle', abbr: 'FRE', primary: '#2D1653', onPrimary: '#FFFFFF', subtle: '#EEE9F6', onSubtle: '#261343', border: '#D2C8E6' },
  GEE: { name: 'Geelong', abbr: 'GEE', primary: '#0B2C4A', onPrimary: '#FFFFFF', subtle: '#E7EEF5', onSubtle: '#0E2A42', border: '#C4D2E0' },
  GCS: { name: 'Gold Coast', abbr: 'GCS', primary: '#E4002B', onPrimary: '#FFFFFF', subtle: '#FCE7EB', onSubtle: '#7A0017', border: '#F2B6C2' },
  GWS: { name: 'GWS Giants', abbr: 'GWS', primary: '#F26522', onPrimary: '#FFFFFF', subtle: '#FDEBE2', onSubtle: '#7A3919', border: '#F6C6A9' },
  HAW: { name: 'Hawthorn', abbr: 'HAW', primary: '#4B2E00', onPrimary: '#FFFFFF', subtle: '#EFE9E0', onSubtle: '#3A2300', border: '#DCCCB4' },
  MEL: { name: 'Melbourne', abbr: 'MEL', primary: '#0C2340', onPrimary: '#FFFFFF', subtle: '#E7EDF5', onSubtle: '#0E2A42', border: '#C4D2E0' },
  NTH: { name: 'North Melbourne', abbr: 'NTH', primary: '#003087', onPrimary: '#FFFFFF', subtle: '#E6EEF8', onSubtle: '#0F2E5E', border: '#B9CBE3' },
  PTA: { name: 'Port Adelaide', abbr: 'PTA', primary: '#0B9DA4', onPrimary: '#0C1C1E', subtle: '#E6F6F7', onSubtle: '#0C3940', border: '#B7E4E6' },
  RIC: { name: 'Richmond', abbr: 'RIC', primary: '#F6BE00', onPrimary: '#1B1B1B', subtle: '#FFF5D9', onSubtle: '#3A2F00', border: '#F3E1A9' },
  STK: { name: 'St Kilda', abbr: 'STK', primary: '#D50032', onPrimary: '#FFFFFF', subtle: '#FCE6EB', onSubtle: '#78001A', border: '#F1B2C0' },
  SYD: { name: 'Sydney', abbr: 'SYD', primary: '#E41F26', onPrimary: '#FFFFFF', subtle: '#FCE6E7', onSubtle: '#7A0F12', border: '#F3B3B6' },
  WCE: { name: 'West Coast', abbr: 'WCE', primary: '#003087', onPrimary: '#FFFFFF', subtle: '#E6EEF8', onSubtle: '#0F2E5E', border: '#B9CBE3' },
  WBD: { name: 'Western Bulldogs', abbr: 'WBD', primary: '#0055A4', onPrimary: '#FFFFFF', subtle: '#E6F0FA', onSubtle: '#0F3763', border: '#B6CDE6' },
};

export function getTeamToken(teamOrAbbr?: string): TeamToken | null {
  if (!teamOrAbbr) return null;
  const key = teamOrAbbr.toUpperCase() as TeamAbbr;
  if (TEAM_TOKENS[key]) return TEAM_TOKENS[key];
  // Try by full name
  const found = (Object.values(TEAM_TOKENS) as TeamToken[]).find(
    (t) => t.name.toLowerCase() === teamOrAbbr.toLowerCase()
  );
  return found || null;
}
