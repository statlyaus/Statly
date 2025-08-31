export function getPlayerPosition(raw?: string | null): string {
  if (!raw) return 'UNK';
  const key = raw.toUpperCase().trim();
  switch (key) {
    case 'D': case 'DEF': case 'DEFENDER': return 'DEF';
    case 'M': case 'MID': case 'MIDFIELDER': return 'MID';
    case 'R': case 'RUC': case 'RUCK': return 'RUC';
    case 'F': case 'FWD': case 'FORWARD': return 'FWD';
    default: return 'UNK';
  }
}
