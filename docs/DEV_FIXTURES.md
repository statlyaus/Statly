# Dev Fixtures

Dev fixtures create repeatable local scenarios for end-to-end product testing.

## Commands

```bash
npm run dev:fixtures -- list
npm run dev:fixtures -- apply full-leagues
npm run dev:fixtures -- verify full-leagues
npm run dev:fixtures -- reset full-leagues --fixture-owned
npm run dev:fixtures -- apply full-leagues --json
```

## full-leagues

`full-leagues` creates or repairs three private 12-team leagues named `Statly Fixture Full League 1..3`.

Each league has:

- the local bypass/dev user in draft slot 1
- 11 fixture bot managers in slots 2-12
- enabled bot profiles
- deterministic rosters from active real players
- a scheduled draft created through the league draft provisioning service
- materialized league season state

The scenario needs enough active players to fill one complete league. With the current settings, that is 264 active players.

## Safety

The fixture runner refuses `NODE_ENV=production`.

Reset requires `--fixture-owned`. Before apply or reset, the runner checks existing fixture leagues and fails if any member is neither the configured dev owner nor a fixture bot user. That prevents deleting or mutating user-created league data that happens to share the fixture name prefix.
