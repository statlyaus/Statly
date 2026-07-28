---
name: product-design-review
description: Use for Statly product-flow and UI review against AFL-first fantasy, responsive, accessibility, and evidence standards.
---

# Statly product-design review

Use this skill for product-level UI changes or audits. It supplements focused component tests; it does
not authorize unrelated redesign or runtime changes.

## Read first

- `AGENTS.md`
- `docs/product/design-principles.md`
- the affected route/layout, shared primitives, and domain documentation
- the supplied design, screenshot, or product goal when one exists

## Review lenses

- AFL authenticity and fantasy task clarity
- ESPN-quality structure for tables, navigation, rosters, and waivers
- SuperCoach-level statistical depth without its clutter
- Yahoo-quality mobile draft/trade task flow and visual polish
- semantic tokens and consistent hierarchy
- keyboard, focus, labels, state announcements, contrast, and reduced motion
- 390px reflow, bounded table scrolling, zoom, and touch targets
- honest loading, empty, error, pending, reconnecting, and persisted-success states

## Evidence loop

1. Capture the current affected state before changing it.
2. Identify the route/layout or shared primitive that owns each finding.
3. Implement the smallest coherent design correction using existing primitives/tokens.
4. Capture the same state after the change at desktop and 390px.
5. Exercise keyboard/focus and primary interactions; inspect console/hydration output.
6. Run focused tests, lint, typecheck, and any relevant browser suite.
7. Report remaining findings by severity and name states that were not reproduced.

Do not retain local screenshot paths or dated audit narration as permanent Markdown. Attach evidence to
the pull request. Do not claim WCAG compliance, performance targets, or cross-browser parity without
the corresponding measurement.
