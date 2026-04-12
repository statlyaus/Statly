# Feature Review Checklist

- Design reviewed, acceptance criteria clear
- Lint, typecheck, tests pass locally
- No server-only imports in client paths (components, hooks, app client files)
- No client SDK imports in server paths (api routes, server utils)
- New or edited App Router handlers use `RouteContext<'/literal'>` or shared route-context helpers in tests
- When editing a route that still uses ad-hoc `params` typing, migrate it to `RouteContext` in the same change if the diff stays small
- New or edited API routes keep transport concerns thin and delegate business logic to services/repository modules when practical
- ETL API routes export `export const runtime = 'nodejs'`
- Env changes validated and added to `.env.example` and README
- Firebase emulator config correct (private server hosts preferred)
- No PII or secrets in logs; avoid `private_key` and `client_email` in client code
- Observability: added minimal initialization log/timing if relevant
