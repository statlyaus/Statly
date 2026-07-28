# Fantasy model

## Category head-to-head

Statly leagues compare the aggregate statistics of active lineup players in a weekly head-to-head
matchup. Each league selects categories and a direction for each category (`HIGH_WINS` or `LOW_WINS`).
Bench and interchange players do not contribute until a valid lineup or autosub transition makes them
active.

The two supported scoring modes are defined in `src/types/leagues.ts` and implemented by
`src/server/leagues`:

- `H2H_EACH_CATEGORY`: category wins, losses, and draws are added directly to the standings.
- `H2H_MOST_CATEGORIES`: the team winning more categories receives one matchup win; equal category
  wins produce a matchup draw.

The default real-data preset is defined in `src/types/fantasyCategories.ts`:

1. goals
2. tackles
3. inside 50s
4. intercepts
5. contested marks
6. rebound 50s
7. contested possessions
8. effective disposals
9. score involvements

The supported category registry, labels, formats, and aliases live in that same source file. Do not
duplicate the registry in documentation or UI-specific constants.

## League and season scope

A league is the tenancy boundary for membership, roles, teams, drafts, rosters, fixtures, trades, and
waivers. Season-dependent features also carry a `LeagueSeason` identity. Every protected query, write,
cache key, room, or event must retain the league and applicable season scope.

Firebase identity establishes who the user is. Prisma membership and role data decide what that user
may see or change in a league. Owner, commissioner, member, roster owner, draft participant, and waiver
claimant permissions are domain decisions, not client navigation decisions.

## League creation defaults

The normalization boundary in `src/server/leagues/createLeagueContract.ts` supplies defaults when a
client omits optional values:

- 12 maximum teams
- private visibility
- UTC timezone
- automatic fixture generation
- `H2H_EACH_CATEGORY` scoring
- the real-data nine-category preset
- normalized active lineup slots and category directions

Clients may expose additional choices, but they must submit values supported by the server contract.

## Matchup calculation

For each category, active player totals are aggregated for both teams and compared in the configured
direction. Missing or non-finite values normalize to zero at the scoring boundary. The result records
home/away totals, the category winner or draw, category win counts, and the overall matchup result.

Standings retain both matchup and category records. `H2H_EACH_CATEGORY` ranks by the accumulated
category result; `H2H_MOST_CATEGORIES` ranks by matchup wins/losses/draws while retaining category
totals for deterministic secondary ordering and display.

## Fixtures, lineups, and finals

League settings own the fantasy schedule, selected AFL window, lock policy, lineup slots, fixture
generation, and finals format. A fantasy bye/no-matchup week is different from an AFL club bye. Player
locks follow the configured policy and must not be inferred from browser time alone.

Autosubs are resolved from saved lineup state and participation evidence. They must be deterministic,
persisted, and auditable; a player contributes at most once. Commissioner changes to published
competition state require an audit record and recalculation of affected future state.

The full product contract is in [league competition rules](../product/league-competition-rules.md).

## Data boundaries

Prisma owns protected fantasy state. Firestore match-stat documents are external scoring evidence and
compatibility projections. Normalize category names and player identity before they reach scoring;
never repair ambiguous identity by silently creating or merging protected rows in a read path.
