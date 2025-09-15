# Feature Review Checklist

- Design reviewed, acceptance criteria clear
- Lint, typecheck, tests pass locally
- No server-only imports in client paths (components, hooks, app client files)
- No client SDK imports in server paths (api routes, server utils)
- ETL API routes export `export const runtime = 'nodejs'`
- Env changes validated and added to `.env.example` and README
- Firebase emulator config correct (private server hosts preferred)
- No PII or secrets in logs; avoid `private_key` and `client_email` in client code
- Observability: added minimal initialization log/timing if relevant

