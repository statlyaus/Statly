## PR Checklist

- [ ] Lint, typecheck, and tests pass locally
- [ ] Branch completion check ran (`npm run branch:complete`) or the reason it was skipped is documented
- [ ] Staged/committed files were reviewed for intentional scope and unrelated changes
- [ ] Commit messages follow Conventional Commit style (`type(scope): summary`)
- [ ] No server-only imports in client code (`@/lib/firebaseAdmin`, `firebase-admin`)
- [ ] No client SDK imports in server code (`@/lib/firebaseClient`, `firebase/app`)
- [ ] ETL routes export `export const runtime = 'nodejs'`
- [ ] Env changes documented in README and `.env.example`
- [ ] No secrets leaked (e.g., `private_key`, `client_email`) in client bundle

### Summary

Describe what changed and why. Include any migration notes or follow-ups.
