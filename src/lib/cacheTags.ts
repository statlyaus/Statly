export const tags = Object.freeze({
  league: Object.freeze((leagueId: string) => `league-${leagueId}`),
  draft: Object.freeze((leagueId: string) => `draft-${leagueId}`),
  trades: Object.freeze((leagueId: string) => `trades-${leagueId}`),
  waivers: Object.freeze((leagueId: string) => `waivers-${leagueId}`),
});


