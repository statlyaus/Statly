/**
 * One page of a league's available waiver players, sorted by id. A search filters every available
 * player by name before paging, so it is not limited to the pages already loaded. A deep-linked
 * player (the player page's "Waiver claim" link) is put first on the first page when he is
 * available but beyond it, so the claim form can select him.
 */
export function pageAvailablePlayers<T extends { id: string; name: string }>(
  players: readonly T[],
  input: { limit: number; cursor?: string; search?: string; requestedPlayerId?: string }
): { page: T[]; hasMore: boolean } {
  const search = input.search?.trim().toLowerCase();
  const matching = search
    ? players.filter((player) => player.name.toLowerCase().includes(search))
    : players;
  const { cursor } = input;
  const afterCursor = cursor ? matching.findIndex((player) => player.id > cursor) : 0;
  const start = afterCursor >= 0 ? afterCursor : matching.length;
  const page = matching.slice(start, start + input.limit);
  const hasMore = start + page.length < matching.length;

  if (!cursor && input.requestedPlayerId) {
    const requested = matching.find((player) => player.id === input.requestedPlayerId);
    if (requested && !page.includes(requested)) page.unshift(requested);
  }
  return { page, hasMore };
}
