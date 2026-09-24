# Authorization model

- Status: documented current behaviour; describes what is enforced today, not a proposed redesign
- Last verified against source: 2026-09-20

Statly keeps three questions separate: who is calling, which league context they are acting in, and
whether the action is operational rather than competition state.

## Access tiers

| Tier               | Requirement                                     | Resolved by                                                      | Examples                                                                       |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Public             | none                                            | route code                                                       | player and match reads, public draft and trade research, `/api/ping`           |
| User               | verified Firebase identity                      | `getAuthenticatedUserId` (`src/lib/serverAuth.ts`)               | user watchlists, user league settings, team actions                            |
| League participant | active `LeagueMember`                           | `getLeagueMembershipAccess` (`src/server/leagues/membership.ts`) | own roster and lineup writes, social posting, own draft queue and watchlist    |
| League manager     | league owner or co-commissioner                 | `canManageLeague` / `LeagueMembershipAccess.canManage`           | waiver processing, league settings, social moderation, draft lifecycle actions |
| Operator           | `x-admin-secret` header carrying `ADMIN_SECRET` | `isAdminRequest` (`src/lib/adminAuth.ts`)                        | queue and worker control plane                                                 |
| Scheduler          | `Authorization: Bearer $CRON_SECRET`            | per-route cron guards                                            | `/api/cron/*`                                                                  |
| Local development  | non-production only, both dev-auth flags true   | `isServerDevelopmentAuthEnabled` (`src/lib/devAuth.ts`)          | scripted identity `statly-dev-tester`                                          |

Each tier above Public resolves identity at the transport boundary and then calls shared server logic
that owns league, season, and membership scope. A verified Firebase UID never implies membership,
commissioner rights, roster ownership, or waiver eligibility.

## League roles

`LeagueRole` has two values: `OWNER` and `MANAGER`. `MANAGER` is the ordinary participant, the team
manager. Delegated league administration is not a role value; it is the `LeagueMember.isCoCommissioner`
flag. The canonical owner is `League.ownerId`, independent of membership rows.

Membership counts as active when `isActive` is true and `status` is not `declined`, `inactive`, or
`removed`.

## Manager rule

The Prisma authority resolves a caller through `getLeagueMembershipAccess`:

- `isMember` requires an active Prisma membership or, on the legacy path, an embedded or legacy
  Firestore member document.
- `canManage` is `league.ownerId === userId || member.isCoCommissioner`. The membership `role` value
  is not consulted on the Prisma path.

Two further implementations of the same decision exist and must stay consistent:

- `src/server/leagues/trades/tradeService.ts` computes `isCommissioner` inline as
  `league.ownerId === userId || member.isCoCommissioner`.
- `firestore.rules` `isLeagueManager()` accepts `owner`, `commissioner`, `admin`, or `manager`,
  case-insensitively, or the league document `ownerId`.

`isLeagueManagerRole` (`src/lib/leagueMembership.ts`) implements that Firestore-era rule. The values
`commissioner` and `admin` cannot be produced by the current Prisma enum; they only occur as legacy
Firestore data.

## Known divergences

These are recorded so a change cannot silently widen or narrow access. Correcting them is a separate
reviewed change, not a drive-by edit.

- `member.role` affects manager status on the Firestore path but not on the Prisma path. A member with
  role `MANAGER` is an ordinary participant to the Prisma authority and a manager to
  `firestore.rules` `isLeagueManager()`.
- The word manager means league administrator in `isLeagueManagerRole` and ordinary participant in
  `LeagueRole.MANAGER`.
- Active-membership logic is duplicated with the same status list in `isActivePrismaMembership`
  (`src/server/leagues/membership.ts`) and `isActiveMembershipData` (`src/lib/leagueMembership.ts`).

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
