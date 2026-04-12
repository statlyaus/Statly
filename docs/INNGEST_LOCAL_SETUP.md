# Inngest Local Setup

This repo exposes Inngest functions at:

- `http://localhost:3000/api/inngest`

## Local development

Run the app with the Inngest Dev Server:

```bash
npm run dev:with-inngest
```

This starts:

- the Inngest Dev Server
- Next.js with `INNGEST_DEV=1`
- the Socket.IO server

If you also need Firebase emulators:

```bash
npm run dev:full:emu:inngest
```

This starts:

- the Inngest Dev Server
- Firebase auth/firestore emulators
- Next.js with `INNGEST_DEV=1`
- the Socket.IO server

## Repair workflow

To enqueue a repair for an already-completed draft:

```bash
npm run inngest:repair-draft -- --draft=<draftId> --league=<leagueId> --season=2026
```

Or call:

- `POST /api/admin/draft-repair`

With body:

```json
{
  "draftId": "draft-id",
  "leagueId": "league-id",
  "season": 2026
}
```

When `ADMIN_API_TOKEN` or `CRON_SECRET` is set, include:

- header `x-admin-token: <token>`

## Trade veto window sweep

Cron (every 15 minutes, UTC): `trade-veto-window-sweep` loads Prisma trades in `REVIEW_PENDING` with `reviewMode = VETO` whose `reviewWindowEndsAt` has passed, then calls `tradeService.finalizeTradeReview` (league owner as audit actor). This completes trades after the configurable **`League.tradeVetoPeriodHours`** window without a user action.

The function is registered in `src/app/api/inngest/route.ts` (`tradeVetoWindowSweepFunction` alongside draft handlers).

## Production (Inngest Cloud)

After you deploy the Next app:

1. In the [Inngest dashboard](https://app.inngest.com), open your app and confirm the **synced URL** matches your deployment (e.g. `https://<your-domain>/api/inngest`).
2. Under **Functions**, confirm **`trade-veto-window-sweep`** (or the display name from `tradeVetoWindowSweepFunction`) is listed and shows a schedule — if it is missing, re-sync the app or fix env so Inngest can reach `/api/inngest`.
3. Set **`INNGEST_SIGNING_KEY`** (and related Inngest env vars your host expects) on the deployment so Inngest can call your handler securely.

Without step 2–3, veto windows may never auto-complete in production even though local dev works.

## Notes

- Keep the synchronous post-draft roster sync in place. Inngest currently handles follow-up orchestration, not the core roster write guarantee.
- `draft.completed` and `draft.repair-requested` both flow through the same background follow-up logic.
- The current workflow rematerializes league season state and prewarms matchup slates for the resolved round.

## References

- Inngest local development: [docs](https://www.inngest.com/docs/local-development)
- Inngest self-hosting and SDK env vars: [docs](https://www.inngest.com/docs/self-hosting)
