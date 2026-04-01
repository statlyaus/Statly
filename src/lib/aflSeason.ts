export function getDefaultAflSeason(now: Date = new Date()): number {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 3 ? year : year - 1;
}

export function getRecentAflSeasons(count = 3, now: Date = new Date()): number[] {
  const currentSeason = getDefaultAflSeason(now);
  return Array.from({ length: Math.max(1, count) }, (_, index) => currentSeason - index);
}
