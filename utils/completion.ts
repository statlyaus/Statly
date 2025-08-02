// Example logic: all positions filled and under salary cap
interface Team {
  players: unknown[];
  salaryUsed: number;
}

export function isTeamComplete(
  team: Team | null | undefined,
  salaryCap: number
): boolean {
  // Example: team = { players: [...], salaryUsed: number }
  const requiredPlayers = 22; // or whatever your rules are
  if (!team || !team.players) return false;
  return team.players.length === requiredPlayers && team.salaryUsed <= salaryCap;
}
