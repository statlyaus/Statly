# Statly Codex Guide

## Product

Statly is an AFL fantasy platform built around category head-to-head leagues. Teams compare selected
stat categories each matchup; leagues can record every category result or award one matchup result to
the team winning the most categories. The default real-data preset is goals, tackles, inside 50s,
intercepts, contested marks, rebound 50s, contested possessions, effective disposals, and score
involvements.

## Repository map

- `src/app`: Next.js pages and HTTP transport routes.
- `src/server`: shared domain services, repositories, workers, and read models.
- `src/types`: cross-boundary domain and API types.
- `prisma`: relational schema and migrations.
- `etl`: Footywire/fitzRoy ingestion into the live-stat boundary.
- `tests` and colocated `*.test.*`: regression and browser coverage.
- `docs`: canonical architecture, domain, development, product, and runbook documentation.

## Sources of truth

- Prisma services own protected league, season, membership, draft, pick, roster, lineup, matchup,
  trade, and waiver state.
- Firebase Authentication owns identity. Verified Firebase UIDs must still pass league- and
  season-scoped authorization at the server/data boundary.
- Firestore is an ingestion or compatibility projection surface; it must not silently become the
  authority for protected fantasy state.
- Redis coordinates ephemeral queues, locks, caches, and Socket.IO delivery. Durable domain state
  belongs in Prisma.
- `src/types/fantasyCategories.ts` defines valid categories and the default preset.
- `src/server/leagues` owns league scoring, standings, fixtures, and competition rules.
- `src/server/draft` owns draft commands, persisted picks, projections, and realtime publication.

See [documentation index](docs/README.md), [runtime boundaries](docs/architecture/data-platform.md),
and [fantasy model](docs/domain/fantasy-model.md). Draft-room reliability work may use
`.agents/skills/draft-reliability-loop/SKILL.md`.

## Setup and verification

Use Node 22 and npm:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Run checks relevant to the changed boundary. Before a pull request, run the full supported set:

```sh
npm run docs:check
npm run lint:ci
npm run typecheck
npm run test:unit
npm run test:int
npm run test:race
npm run test:e2e
npm run build
```

Use disposable databases or fixtures for verification. Never use `prisma/dev.db` as a test target.

## Safety boundaries

- Never read, print, stage, or commit `.env*`, `.Renviron`, credentials, service-account JSON,
  Firebase exports, local databases, or generated test/build output. Only clearly named examples
  belong in Git.
- Do not mutate shared or production data without an explicit, reviewed runbook and authorization.
- API routes are transport adapters. Authenticate there, then call shared server logic that enforces
  membership, role, league, and active-season ownership.
- Draft picks, roster projection, queue/watchlist state, and waiver availability must converge from
  one persisted command boundary and survive refresh/reconnect.
- ETL uses Footywire through fitzRoy and fails closed; do not add mock fallback to production paths or
  normalize weak external identities inside rendering code.

## Review rules

1. Reject changes that authorize only in UI or route code while leaving the data boundary open.
2. Reject cross-league or cross-season queries, cache keys, events, and writes without explicit scope.
3. Reject realtime success that is not backed by persisted state and reconnect/catch-up behavior.
4. Reject Firestore or fallback data becoming canonical through an error path.
5. For UI work, preserve semantic tokens, keyboard access, accessible names, focus visibility, and
   mobile reflow; use `.agents/skills/product-design-review/SKILL.md` for product-level reviews.

## Done

A change is done when the requested behavior and owning boundary are correct, focused regression
coverage passes, relevant lint/type/test/build checks pass, browser behavior is verified when user
flows changed, documentation matches the result, and the diff contains no protected or unrelated
files. Delivery follows [the pull-request runbook](docs/development/delivery.md).
