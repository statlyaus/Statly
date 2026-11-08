# Authorization model

- Status: documented current behaviour; describes what is enforced today, not a proposed redesign
- Last verified against source: 2026-10-04

Statly keeps three questions separate: who is calling, which league context they are acting in, and
whether the action is operational rather than competition state.

## Access tiers

| Tier                     | Requirement                                               | Resolved by                                                                                | Examples                                                                       |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Public                   | none                                                      | route code                                                                                 | player and match reads, public draft and trade research, `/api/ping`           |
| User                     | verified Firebase identity                                | `getAuthenticatedUserId` (`src/lib/serverAuth.ts`)                                         | user watchlists, user league settings, team actions                            |
| League participant       | active `LeagueMember`                                     | `getLeagueMembershipAccess` (`src/server/leagues/membership.ts`)                           | own roster and lineup writes, social posting, own draft queue and watchlist    |
| League manager           | league owner or co-commissioner                           | `canManageLeague` / `LeagueMembershipAccess.canManage`                                     | waiver processing, league settings, social moderation, draft lifecycle actions |
| Basketball profile owner | `BasketballLeague.ownerId === userId`; non-owners get 404 | `requireBasketballLeagueOwner` (`src/server/basketball/leagues/basketballLeagueAccess.ts`) | `/api/basketball/leagues/*`, `/basketball` pages                               |
| Operator                 | `x-admin-secret` header carrying `ADMIN_SECRET`           | `isAdminRequest` (`src/lib/adminAuth.ts`)                                                  | queue and worker control plane                                                 |
| Scheduler                | `Authorization: Bearer $CRON_SECRET`                      | `isCronRequestAuthorized` (`src/lib/cronAuth.ts`)                                          | `/api/cron/*`                                                                  |
| Local development        | non-production only, both dev-auth flags true             | `isServerDevelopmentAuthEnabled` (`src/lib/devAuth.ts`)                                    | scripted identity `statly-dev-tester`                                          |

Each tier above Public resolves identity at the transport boundary and then calls shared server logic
that owns league, season, and membership scope. A verified Firebase UID never implies membership,
commissioner rights, roster ownership, or waiver eligibility.

`src/lib/serverAuth.ts` resolves a credential Firebase rejects (expired, revoked, malformed, or
belonging to a disabled or deleted user) to no identity. A verification that could not run, such as
Firebase Admin being unreachable or misconfigured, rejects instead: pages show the error boundary and
routes fail with a server error, rather than sending a signed-in browser to `/login` and back.

## League roles

`LeagueRole` has two values: `OWNER` and `MANAGER`. `MANAGER` is the ordinary participant, the team
manager. Delegated league administration is not a role value; it is the `LeagueMember.isCoCommissioner`
flag. The canonical owner is `League.ownerId`, independent of membership rows.

Membership counts as active when `isActive` is true and `status` is not `declined`, `inactive`, or
`removed`.

## Manager rule

The Prisma authority resolves a caller through `getLeagueMembershipAccess`:

- `isMember` requires an active Prisma membership. A league with no Prisma row, or a user with no
  active Prisma membership, is not a member. Firestore member and league documents never decide
  membership, role, or the member list (`src/lib/leagueMembership.ts` reads Prisma only; its
  Firestore helpers only write or locate the compatibility projection).
- `canManage` is `league.ownerId === userId || member.isCoCommissioner`. The membership `role` value
  is not consulted.

Two further implementations of the same decision exist and must stay consistent:

- `src/server/leagues/trades/tradeService.ts` computes `isCommissioner` inline as
  `league.ownerId === userId || member.isCoCommissioner`.
- `firestore.rules` `isLeagueManager()` accepts `owner`, `commissioner`, `admin`, or `manager`,
  case-insensitively, or the league document `ownerId`.

The values `commissioner` and `admin` cannot be produced by the current Prisma enum; they only occur
as legacy Firestore data.

## Basketball profiles

A fantasy basketball league profile is private to the user who created it. It has no members or
roles: the only rule is `BasketballLeague.ownerId === userId`. Every query in
`src/server/basketball/leagues` filters by owner, and every team, roster spot and matchup read or
write is also scoped to the league id. Someone else's league answers 404 exactly like a league that
does not exist, from the API and from pages (`loadOwnedBasketballLeague` returns null and the page
calls `notFound()`), so a profile's existence never leaks. The global `Nba*` reference tables hold no
user data; player search only needs a signed-in user.

## Known divergences

These are recorded so a change cannot silently widen or narrow access. Correcting them is a separate
reviewed change, not a drive-by edit.

- `member.role` affects manager status in `firestore.rules` but not in the Prisma authority. A member
  with role `MANAGER` is an ordinary participant to the Prisma authority and a manager to
  `firestore.rules` `isLeagueManager()`.
- The word manager means league administrator in `firestore.rules` `isLeagueManager()` and ordinary
  participant in `LeagueRole.MANAGER`.
- Active-membership logic is duplicated with the same status list in `isActivePrismaMembership`
  (`src/server/leagues/membership.ts`) and `isActiveMembershipData` (`src/lib/leagueMembership.ts`).

## Firestore client access

Browser clients never write league state to Firestore. `firestore.rules` grants signed-in clients
reads of the league projection they belong to and writes only to their own `users/{uid}` documents
(dashboard settings). Every league path, including rosters, lineups and member documents, is
`allow write: if false`; only server code writes the projection, through the Admin SDK.
`tests/unit/firestoreRulesArchitecture.test.ts` fails if any other path gains a client write grant.
Rules and indexes reach Firebase only on the next `firebase deploy`.

## Rules for changes

- Authorize at the data boundary; reject changes that authorize only in UI or route code.
- Derive the acting user from the verified credential. Never accept a client-supplied user or member
  identifier as an authorization input.
- Scope every query, cache key, event, and write to the league and season of the resolved context.
- Keep operator and scheduler credentials out of league role logic; they authorize infrastructure
  actions, not competition state.
- Preserve fail-closed behaviour: an unset credential denies access.

## Testing

Local credentials, helper commands, and the automated contract are documented in
[secured endpoint testing](../development/testing.md).
