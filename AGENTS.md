# AGENTS.md

## Purpose

Statly ingests AFL source data, persists canonical raw event documents to Firestore, rebuilds serving projections, and exposes app and API consumers through read models optimized for product use.

For the Footywire pipeline, the primary engineering goal is architectural convergence:

- Firestore raw-match documents are the single persisted semantic contract for Footywire-derived player-match data.
- Downstream ingestion, rebuild, and read-model code consumes that contract directly.
- Reconciliation validates convergence between stages instead of compensating for stage drift.
- Repair operations are bounded, repeatable, and operationally safe.

If a change improves short-term output but preserves semantic duplication or stage drift, it is not the right long-term fix.

## Scope

This file defines the operating rules for agent work in this repository.

Use it as the execution contract.

Use supporting docs for deeper rationale and architecture detail, especially:

- `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`
- `docs/DATA_RELIABILITY.md`
- `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md`
- `docs/runtime-contract.md`

Do not duplicate long-form architecture analysis in this file unless the operating rule itself changes.

## Requirements language

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, and `MAY` in this document are to be interpreted as described in BCP 14 / RFC 2119 / RFC 8174 when, and only when, they appear in all capitals.

## Architectural north star

The correct long-term design is:

1. One canonical persisted raw-match contract at the Firestore boundary.
2. One shared vocabulary for stat keys, presence semantics, provenance, and match identity.
3. Zero permanent parallel semantic readers downstream.
4. Scoped rematerialization for the affected repair slice.
5. Explicit authorization and observability for import and rebuild operations.

The repository MUST move toward defining semantic meaning once at the persistence boundary and reusing it everywhere else.

## Canonical contract rules

Firestore is the canonical persistence boundary for Footywire player-match data.

The canonical raw-match contract MUST define, in one place:

- canonical match identity
- canonical player identity linkage
- canonical stat keys
- explicit presence semantics
- source provenance
- source priority
- canonical match metadata required downstream

Canonical contract rules:

- Persisted canonical documents MUST be lossless for the supported Footywire stat surface.
- Canonical stat keys MUST be defined once and reused across ETL, ingestion, reconciliation, and read models.
- Missing, zero, and absent values MUST be represented intentionally and consistently.
- Provenance MUST survive canonicalization, persistence, repair, rebuild, and projection.
- Downstream code MUST NOT reconstruct business meaning from legacy fields if that meaning already exists in the canonical contract.
- When canonical keys change, all writers and readers MUST be updated in the same task.
- Compatibility adapters MAY exist only as temporary migration boundaries. They MUST be isolated, clearly marked, and easy to remove.

## Source-of-truth rules

Firestore canonical raw-match documents are the only persisted semantic source for Footywire-derived player-match data.

Allowed downstream behavior:

- read the canonical contract directly
- derive projections exclusively from the canonical contract
- validate projections against the canonical contract

Forbidden downstream behavior:

- reading legacy top-level Firestore fields as a permanent semantic fallback once canonical data exists
- maintaining a second permanent stat reader with different presence rules
- adding projection-only interpretation logic that overrides persisted canonical meaning
- silently dropping stats because a field is null, empty, missing, or zero-like without explicit contract semantics
- preserving transitional fallback readers indefinitely after the migrated scope is repaired

If a temporary adapter is necessary, keep it in one place, mark it transitional, and remove it as soon as the repaired scope no longer depends on it.

## Current priority

The active priority is eliminating ingestion and projection drift in the Footywire pipeline by finishing end-to-end convergence around the canonical Firestore raw-match contract.

This means:

1. canonical contract ownership lives at the ETL and persistence boundary
2. ingestion and read-model code consumes that exact contract
3. successful imports trigger the rebuild and rematerialization needed for the affected scope
4. repaired scopes are re-imported, rematerialized, and reconciled until drift is eliminated

Failure classes that MUST trend to zero for the repaired scope:

- `dropped_before_raw`
- `dropped_in_projection`

Treat these failures as evidence of architectural misalignment, not isolated bugs.

## Files that usually matter

Read the full path before editing:

- `etl/processFootywireData.ts`
- `src/lib/stats/footywireCanonicalContract.ts`
- `src/lib/footywireStatsIngestion.ts`
- `src/server/readModels/playerReadModels.ts`
- `src/app/api/etl/import-rounds/route.ts`

Search for adjacent code before changing contract behavior:

- Firestore converters
- schema validators
- stat key definitions
- rebuild and rematerialization jobs
- reconciliation scripts
- import scripts
- tests for ETL, read models, and drift detection

## Planning rules

Plan first for any task that:

- changes canonical contract shape
- changes canonical stat vocabulary
- changes presence semantics
- changes provenance behavior
- changes import, rebuild, or rematerialization flow
- touches more than one stage in the ETL-to-projection path
- affects persisted contracts or migration behavior

Before editing, document:

- the invariant or contract being enforced
- affected write paths
- affected read and projection paths
- compatibility or migration strategy
- operational or backfill risk
- verification plan

Prefer the smallest coherent change set that removes duplicated interpretation logic.

Do not make opportunistic refactors unless they are required to complete the architectural repair safely.

## Decision rule

When choosing between:

- a smaller patch that preserves duplicated readers or semantics
- a slightly larger change that centralizes meaning once

prefer the centralizing change unless migration risk is materially higher.

The default bias in this repository is toward the best long-term solution, not the narrowest immediate diff.

That means changes SHOULD:

- define semantics once
- reuse the shared canonical contract
- reduce stage drift
- narrow rebuild scope
- preserve provenance
- be easy to verify repeatedly
- leave fewer transitional readers behind

## Editing rules

When implementing:

- update writer and reader code in the same change set when changing canonical semantics
- keep naming consistent across ETL, ingestion, reconciliation, and read models
- prefer explicit canonicalization helpers over scattered inline mappings
- centralize contract helpers rather than duplicating field logic
- remove obsolete fallback readers when safe
- add comments only where semantics are easy to misread

Do not preserve drift for convenience.

Do not introduce a new interpretation layer to avoid touching the canonical contract.

Do not leave migration-only code behind without exit criteria.

## Rematerialization and rebuild rules

Successful import is not sufficient if projections remain stale.

Repair paths MUST be operationally complete:

- successful imports MUST trigger the rebuild or rematerialization required for app-facing correctness
- rebuild scope SHOULD be bounded to affected rounds, matches, players, or season slices when possible
- full-season rebuilds SHOULD be reserved for recovery and backfill operations, not default narrow-scope repair
- repair steps MUST preserve provenance and contract semantics through to serving projections

Smaller explicit rematerialization slices are preferred because they are faster, safer, and easier to verify.

## Security and operational rules

Import and rebuild paths are high-impact mutation paths.

Authorization and observability are part of the design.

When modifying these flows:

- authorization policy MUST be explicit by environment
- permissive defaults MUST NOT be relied on in shared environments
- import and rebuild behavior SHOULD be operationally reviewable
- auditability for raw-data mutation and projection publication MUST be preserved or improved

If a route or job mutates canonical raw data or republishes projections, assume it needs an explicit security posture.

## Verification requirements

Do not call a task done until the narrowest relevant existing checks have been used to prove convergence for the touched scope.

Required verification, where available:

- run relevant typecheck, lint, and tests for touched files
- run the relevant import or ETL path for the affected slice
- run rebuild or rematerialization for the affected scope
- run reconciliation for:
  - targeted players
  - bounded season or round scopes
- confirm whether each failure class still appears:
  - `dropped_before_raw`
  - `dropped_in_projection`

Verification MUST prove all of the following:

- raw persisted documents contain the intended canonical data
- downstream projections consume that canonical data correctly
- repaired scope no longer depends on legacy semantic readers
- rebuild scope matches the size of the repair
- provenance and presence semantics were preserved

If a command does not exist, say so explicitly and identify the nearest existing command or manual verification path. Do not invent script names.

## Branch completion workflow

After making repository changes, read `docs/BRANCH_COMPLETION_GUIDE.md` before staging, committing, pushing, preparing a PR, or claiming the work is complete.

For non-trivial code, data, configuration, or documentation changes:

- run `npm run branch:complete` before the final response when practical
- inspect `git status --short --branch`, `git diff --stat`, and staged changes before committing
- stage only intentional files for the current concern
- keep unrelated user changes, generated artifacts, local databases, emulator exports, secrets, and scratch output out of commits
- use Conventional Commit style for commit messages: `type(scope): summary`
- leave the existing pre-push hook and `npm run prepush` as the hard quality gate before push

If `npm run branch:complete` or `npm run prepush` cannot run, report why and identify the closest verification that did run.

## Output expectations for non-trivial work

For non-trivial tasks, respond with:

1. plan
2. contract or invariant changes
3. files changed
4. migration or operational risks
5. verification performed
6. remaining gaps or follow-ups

## Review checklist

Flag the change if any of the following are true:

- more than one persisted semantic contract exists for Footywire player-match data
- downstream code still interprets raw documents through parallel readers instead of the canonical contract
- import success does not trigger the rebuild or rematerialization needed for app-facing correctness
- provenance is dropped or degraded during canonicalization, repair, rebuild, or projection
- missing, zero, and absent semantics are ambiguous or inconsistent
- a compatibility adapter is introduced without isolation and clear removal intent
- rebuild scope is broader than necessary for the repair slice
- a new path can reintroduce stage drift between persisted raw documents and projections
- either failure class remains unresolved for the claimed repaired scope:
  - `dropped_before_raw`
  - `dropped_in_projection`

## Done means

A task is complete only when:

- the requested behavior is implemented
- semantic meaning is defined or consumed at the correct contract boundary
- no unnecessary interpretation layer was introduced
- the affected projection path is current
- verification was run for the repaired scope
- the change leaves the system closer to single-contract convergence than before

## Website design system and Figma rules

These rules apply to website, app shell, dashboard, league, form, table, and Figma-driven UI work. The goal is not to freeze the current UI. The goal is to converge Statly toward a durable AFL fantasy product design system while respecting the code already in place.

The product design source of truth is `STATLY_DESIGN_SYSTEM.md`. Use it to judge whether a UI change improves fast decision-making, high trust, AFL-specific depth without clutter, and mobile-ready team management.

## Current UI stack and ownership

- The app uses Next.js App Router, React, TypeScript, Tailwind CSS, and shadcn-style open components.
- Routes and route-specific clients live in `src/app/`.
- Shared UI primitives live in `src/components/ui/`.
- Product and feature components live in `src/components/` and feature subdirectories such as `src/components/dashboard/`, `src/components/league/`, `src/components/navigation/`, `src/components/trades/`, `src/components/rankings/`, and `src/components/draft/`.
- Utility class composition uses `cn` from `src/lib/utils.ts`.
- shadcn configuration lives in `components.json`; follow its aliases, New York style, React Server Component setting, TypeScript setting, and lucide icon preference.
- Global theme tokens live in `src/index.css` using Tailwind `@theme inline` variables and CSS variables under `:root` and `.dark`.
- League workspace tokens live as `--league-*` variables in `src/index.css`; reusable league class patterns live in `src/styles/leagueDesignSystem.ts`.
- App assets currently live under `public/Assets/`, `public/images/`, and `public/logos/`. Keep new assets in the closest existing location unless a broader asset migration is explicitly planned.

## Long-term design direction

Statly should feel like a modern AFL fantasy operations product: dense, credible, fast to scan, and polished without becoming decorative. ESPN Fantasy, SuperCoach, and Yahoo Fantasy are useful benchmarks, but the implementation should be Statly-specific rather than copied from any one product.

Long-term UI work SHOULD converge on:

- semantic theme tokens for color, surfaces, borders, focus, and status
- shadcn-style primitives composed into feature-specific product surfaces
- predictable table, filter, tab, dialog, toast, badge, and form interaction models
- stable data layouts for player rankings, rosters, matchups, drafts, trades, live scoring, waivers, and league management
- mobile-specific layouts for core fantasy tasks instead of shrinking desktop tables by default
- visual hierarchy that puts the next useful decision near the relevant data
- explicit loading, empty, error, stale-data, and last-updated states for data-heavy views

Long-term UI work SHOULD NOT preserve:

- repeated hard-coded gray, slate, blue, red, green, yellow, or purple Tailwind ramps where a semantic role exists
- one-off panel, card, badge, and button strings copied between features
- generic SaaS dashboard layouts that hide fantasy decisions behind decorative cards
- oversized marketing-style hero sections inside logged-in product workflows
- interaction models that behave differently for the same action in different features
- new Heroicons or React Icons usage when lucide has an equivalent icon

## Preferred patterns vs legacy drift

Preferred patterns:

- Use `UIButton` and `buttonVariants` from `src/components/ui/button.tsx` for standard actions.
- Use `UIInput`, `UITextarea`, `UISelect`, `UILabel`, `UICheckbox`, `UISwitch`, `UITabs`, `UITable`, `tableClasses`, `Popover`, `ScrollArea`, and `Separator` when they fit.
- Use semantic utilities such as `bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `border-border`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground`, `bg-accent`, `text-accent-foreground`, `bg-destructive`, `ring-ring`, and shadcn radius utilities.
- Use `leagueSurfacePatterns` and `--league-*` variables for league workspace surfaces instead of repeating arbitrary class strings.
- Use `lucide-react` for new icons.
- Use native semantic elements first, then ARIA only where needed.

Legacy or transitional patterns:

- Hard-coded `bg-gray-*`, `text-slate-*`, `border-blue-*`, and similar palette classes are common in older components. Do not expand this pattern in new code.
- Older `Badge`, `Alert`, `DataTable`, modal, tooltip, and loading components may contain hard-coded variant maps. Reuse them only when they are already the local pattern and the task does not justify migrating the surface.
- Existing Heroicons and React Icons imports may remain during unrelated changes, but new icon use should prefer lucide.
- Older app-shell surfaces may use generic card-heavy dashboard styling. When touching them for design work, move toward the product design standard in `STATLY_DESIGN_SYSTEM.md`.

## Migration and replacement rules

- IMPORTANT: New UI must use preferred patterns unless there is a concrete compatibility reason not to.
- When editing an existing UI area, improve the touched surface toward semantic tokens, shared primitives, and documented patterns if the change is local and reviewable.
- Do not perform broad visual rewrites as incidental cleanup. If a legacy surface needs replacement across multiple concerns, plan it as a design-system migration with scope, risk, and verification.
- Add or change a global token only for a durable semantic role that recurs across the product. Do not add tokens for one-off colors from a single mockup.
- If a Figma design introduces a visual role that does not exist in code, first map it to existing semantic tokens. Add a new token or variant only when the role is stable and product-level.
- If a component duplicates an existing primitive with only styling differences, prefer adapting the existing primitive or composing it locally instead of creating another wrapper.
- Preserve backwards compatibility for shared component APIs unless the task explicitly allows a breaking change.
- Remove obsolete local styling only when the replacement is within the task scope and behavior can be verified.

## Component and layout rules

- Prefer composition over monolithic custom components.
- New shared primitives SHOULD go in `src/components/ui/` only when there is immediate reuse. Feature-specific UI SHOULD stay near the feature.
- Component APIs should accept `className` for composition and use `cn` to merge classes.
- Keep client components explicit with `"use client"` only when interaction, browser APIs, hooks, or client-only libraries require it.
- Keep data fetching in server components or server utilities where possible; keep client state local to the interaction that needs it.
- Avoid card-in-card layouts. Use full-width sections or constrained page layouts, and reserve cards for repeated items, panels, modals, and genuinely framed tools.
- For dashboards, rankings, matchups, league management, commissioner tools, rosters, trades, drafts, waivers, and live scoring, prioritize scanability, stable alignment, restrained decoration, and predictable controls.
- Tables should preserve numeric alignment, sticky headers where useful, clear sort/filter affordances, and explicit loading/empty/error states.
- Mobile layouts should preserve task completion. If a table is central to the workflow, consider a purpose-built mobile row/card layout rather than relying only on horizontal scroll.

## Styling rules

- IMPORTANT: Do not hardcode hex, rgb, oklch, or arbitrary color values in component markup when a semantic token can express the role.
- Prefer app-wide semantic tokens for neutral surfaces, text, borders, rings, destructive states, and primary actions.
- Prefer league tokens only inside league workspace surfaces or intentionally league-themed components.
- Preserve dark mode. If a surface, text color, border, focus state, status, chart, or badge changes, verify the dark-mode equivalent or use semantic tokens that already map through `.dark`.
- Keep radius, spacing, typography, shadows, and borders consistent with shadcn primitives. The default app radius comes from `--radius` in `src/index.css`.
- Use Tailwind utilities and existing token exports before adding custom CSS. Custom CSS belongs in `src/index.css` only for global tokens, base rules, or reusable animation primitives.
- Use `font-data-table` only where tabular or numeric data benefits from the mono font variable defined in `src/app/layout.tsx`.

## Accessibility and interaction

- Every interactive element must be keyboard accessible and have a visible label or accessible name.
- Icon-only buttons MUST have an `aria-label`.
- Preserve focus visibility with `focus-visible` ring styles tied to `ring-ring` or an equivalent semantic focus treatment.
- Form fields need associated labels. Help and error text should be connected with `aria-describedby`; invalid fields should use `aria-invalid` where applicable.
- Tables should preserve native table semantics. Do not override table roles unless there is a proven accessibility reason.
- Loading, empty, and error states should be explicit for data-heavy views and should not collapse the layout in a way that causes avoidable shift.
- Motion should be purposeful and should not be required to understand or operate the UI.

## Icons and assets

- Use `lucide-react` for new icons because `components.json` declares lucide as the shadcn icon library.
- Existing Heroicons and React Icons imports MAY remain in legacy components, but do not introduce new icon packages.
- Use `public/logos/` for AFL club logos, `public/images/` for general image assets, and `public/Assets/` for existing branded/product imagery unless a task explicitly reorganizes assets.
- Prefer real product, player, team, venue, or gameplay imagery over placeholders when the UI depends on visual recognition.
- IMPORTANT: If Figma MCP returns a localhost URL for an image or SVG asset, use that source directly for implementation work. Do not create placeholders when a real asset source is provided.

## Figma MCP integration rules

These rules define how to translate Figma inputs into Statly code for every Figma-driven change.

1. Run `get_design_context` for the exact Figma node or nodes before implementation.
2. If the response is too large or truncated, run `get_metadata` to inspect the high-level node map, then re-fetch only the necessary nodes with `get_design_context`.
3. Run `get_screenshot` for the exact visual state or variant being implemented.
4. Only after both structured context and screenshot are available, download or reference required assets and begin implementation.
5. Treat Figma MCP generated React and Tailwind as design intent, not final Statly code. Translate it into this repo's component, token, asset, and routing conventions.
6. Reuse `src/components/ui/` primitives, feature components, `src/index.css` tokens, `src/styles/leagueDesignSystem.ts` patterns, and existing assets before adding new components or styles.
7. Map Figma color, surface, text, border, radius, shadow, and focus decisions to semantic tokens first. Add or adjust tokens only when the design introduces a durable semantic role.
8. Compare the implemented UI against the Figma screenshot for hierarchy, spacing, typography, responsive behavior, and state coverage before marking the task complete.

## Verification for UI work

- For component-only changes, run the narrowest available lint, typecheck, or test target that covers the touched file.
- For app-page or interaction changes, run the local dev server when practical and verify the relevant viewport and workflow in a browser.
- For Figma-driven work, include what was checked against Figma and any known visual differences.
- For design-system migrations, verify at least one representative desktop and mobile viewport, dark mode, keyboard access for changed controls, and loading/empty/error states where applicable.
- Before completion, review the diff for hard-coded colors, lost dark-mode support, inaccessible controls, duplicated primitives, one-off class strings that should be tokens, and unintended layout shifts.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:

- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
