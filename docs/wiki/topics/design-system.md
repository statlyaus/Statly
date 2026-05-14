---
title: 'Design System'
type: 'topic'
status: 'current'
last_updated: '2026-05-14'
sources:
  - 'AGENTS.md'
  - 'STATLY_DESIGN_SYSTEM.md'
tags:
  - 'design-system'
  - 'ui'
  - 'shadcn'
  - 'product'
---

# Design System

Statly's product design target is a modern AFL fantasy operations product: dense, credible, fast to scan, and polished without becoming decorative.

## Product Standard

`STATLY_DESIGN_SYSTEM.md` defines four product outcomes:

- fast decisions
- high trust
- AFL-specific depth without clutter
- mobile-ready team management

UI work should be judged against those outcomes, not only against visual consistency.

## Implementation Direction

`AGENTS.md` says new UI should use preferred patterns unless there is a concrete compatibility reason not to.

Preferred implementation patterns include:

- shadcn-style open components
- semantic utilities such as `bg-background`, `text-foreground`, `border-border`, and `ring-ring`
- `UIButton` and `buttonVariants` for standard actions
- lucide icons for new icon use
- `cn` from `src/lib/utils.ts` for class composition
- league workspace tokens only inside league-themed surfaces

Legacy hard-coded Tailwind palette classes may remain during unrelated changes, but new work should avoid expanding that pattern.

## Migration Posture

The design system should converge incrementally. When touching an existing UI surface, improve the local surface toward semantic tokens, shared primitives, and documented patterns if the change remains reviewable.

Broad visual rewrites should be planned explicitly as design-system migration work.

## Verification Expectations

For UI changes, verification should check:

- relevant lint, typecheck, or test target
- browser behavior for app-page or interaction changes
- desktop and mobile layout for significant surfaces
- dark mode when colors, surfaces, or borders change
- keyboard access and accessible labels for interactive controls
- loading, empty, and error states for data-heavy views

## Related Pages

- [[overview]]
- [[questions]]
