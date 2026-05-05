const TEAM_ALIASES: Record<string, string> = {
  ade: 'Adelaide',
  adelaide: 'Adelaide',
  'adelaide crows': 'Adelaide',
  bri: 'Brisbane',
  bris: 'Brisbane',
  brl: 'Brisbane',
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
  fit: 'Fitzroy',
  fitzroy: 'Fitzroy',
  'fitzroy fc': 'Fitzroy',
  'fitzroy football club': 'Fitzroy',
  'fitzroy lions': 'Fitzroy',
  ffc: 'Fitzroy',
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
  kan: 'North Melbourne',
  kangaroos: 'North Melbourne',
  nm: 'North Melbourne',
  nor: 'North Melbourne',
  nth: 'North Melbourne',
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
  wbd: 'Western Bulldogs',
  bulldogs: 'Western Bulldogs',
  dogs: 'Western Bulldogs',
  'western bulldogs': 'Western Bulldogs',
  footscray: 'Western Bulldogs',
  wc: 'West Coast',
  'west coast': 'West Coast',
  'west coast eagles': 'West Coast',
};

const AFL_TEAM_ABBREVIATIONS: Record<string, string> = {
  Adelaide: 'ADE',
  Brisbane: 'BRI',
  Carlton: 'CAR',
  Collingwood: 'COL',
  Essendon: 'ESS',
  Fitzroy: 'FIT',
  Fremantle: 'FRE',
  Geelong: 'GEE',
  'Gold Coast': 'GCS',
  GWS: 'GWS',
  Hawthorn: 'HAW',
  Melbourne: 'MEL',
  'North Melbourne': 'NOR',
  'Port Adelaide': 'POR',
  Richmond: 'RIC',
  'St Kilda': 'STK',
  Sydney: 'SYD',
  'West Coast': 'WCE',
  'Western Bulldogs': 'BUL',
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
  return raw
    .trim()
    .replace(/^(vs|v|at)\s+/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '');
}

export function getAflTeamAbbreviation(raw: string | null | undefined): string {
  const normalized = normalizeTeamName(raw ?? '');
  if (!normalized) return 'UNK';
  return AFL_TEAM_ABBREVIATIONS[normalized] ?? normalized.substring(0, 3).toUpperCase();
}
