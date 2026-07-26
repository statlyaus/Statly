# Fantasy application design comparison

- Date: 2026-07-26
- Branch: `codex/site-design-principles-audit`
- Comparators: [AFL Fantasy](https://fantasy.afl.com.au/), [SuperCoach](https://www.supercoach.com.au/), [Sleeper](https://sleeper.com/fantasy), and [Fantrax](https://www.fantrax.com/)
- Scope: current public entry, discovery, score, and authentication surfaces available without creating or using an external account.
- Baseline: [Statly website design audit](./website-design-audit-2026-07-26.md).

## Overall verdict

No comparator is a complete template for Statly. AFL Fantasy is the best reference for authentic AFL identity and a focused Classic/Draft entry. Sleeper is the strongest reference for dense live information that remains scannable and for mobile reflow that preserves the primary action. Fantrax has the clearest theatrical hero and a compact login, but stylized athletes weaken sporting authenticity. SuperCoach shows useful mode and login framing on desktop while reproducing the same unrecoverable off-canvas mobile failure already found in Statly.

The best direction for Statly is therefore a combination: **AFL Fantasy's authenticity, Sleeper's information hierarchy, Fantrax's single-minded above-fold message, and none of SuperCoach's fixed-width mobile behavior.**

## Audit evidence

- Capture tool: Codex in-app Browser.
- Viewports: 1440×900 and 390×844.
- Evidence: 13 screenshots captured and visually inspected during this audit.
- Screenshot archive: `/Users/robert/.codex/visualizations/2026/07/26/019f9f1b-a0e6-7ce0-a679-10c9bf789a1e/comparative-app-audit/`.
- Cookie notices were left visible where they affected the first-run experience.
- Public DOM structure was checked to distinguish missing content from rendered-layout failures.

## Evidence steps

| Step | Product and state                             | Health    | Evidence-backed assessment                                                                                                                                                                                                                                                                                                                    |
| ---: | --------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | AFL Fantasy game selector, desktop and mobile | **Good**  | Three large, image-led choices make AFLW, Classic, and Draft immediately recognizable. The mobile cards become a clean vertical sequence without losing their labels or imagery. Evidence: `01-afl-fantasy-selector-desktop.jpg`, `03-afl-fantasy-selector-mobile.jpg`.                                                                       |
|    2 | AFL Fantasy Classic authentication            | **Good**  | The AFL iD handoff is a focused one-field first step with visible label, persistent account creation, help, privacy, and a clear primary action. Large unused desktop space is acceptable because it protects the task. Evidence: `02-afl-fantasy-login-desktop.jpg`.                                                                         |
|    3 | SuperCoach sport selector, desktop            | **Mixed** | The purpose and sport choices are obvious above the fold, but eight equal-weight choices and oversized brand decoration create more decision load than AFL Fantasy. Evidence: `04-supercoach-entry-desktop.jpg`.                                                                                                                              |
|    4 | SuperCoach public entry, mobile               | **Poor**  | The desktop canvas remains wider than 390px. Labels, sport choices, login/register controls, and promotional text are clipped offscreen with no recoverable horizontal route. This is a responsive layout failure, not a loading capture. Evidence: `06-supercoach-afl-mobile.jpg`, `13-supercoach-entry-mobile.jpg`.                         |
|    5 | Sleeper live scores, desktop                  | **Good**  | Sport filters, competition columns, team marks, scores, states, dates, and broadcast cues form a dense but coherent monitoring surface. The persistent cookie banner materially reduces the visible score area on first visit. Evidence: `07-sleeper-scores-desktop.jpg`.                                                                     |
|    6 | Sleeper fantasy discovery, desktop and mobile | **Good**  | The hero gives one product, status, value statement, product preview, and action. Mobile preserves the hierarchy and CTA, then flows into vertically stacked discovery cards. The carousel and large cookie panel add motion and obstruction risk. Evidence: `08-sleeper-fantasy-desktop.jpg`, `09-sleeper-fantasy-mobile.jpg`.               |
|    7 | Fantrax home, desktop and mobile              | **Mixed** | The headline, sport range, app preview, and authentication choices establish the offer quickly and reflow successfully. The many app/download/login actions compete, the mobile app-store badges clip, and rendered athletes feel less credible than real AFL imagery. Evidence: `10-fantrax-home-desktop.jpg`, `12-fantrax-home-mobile.jpg`. |
|    8 | Fantrax authentication                        | **Good**  | The modal is compact, strongly separated from the page, visibly labeled, and keeps password recovery and sign-up in context. Keyboard order, focus containment, errors, and screen-reader output were not tested. Evidence: `11-fantrax-login-desktop.jpg`.                                                                                   |

## The ten-principle comparison

| Principle                                   | Strongest evidence                                                                                       | Main caution                                                                                         | Direction for Statly                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. Avoid clutter                            | AFL Fantasy's three-card selector; Fantrax's one-line hero                                               | Sleeper's score surface is intentionally dense; SuperCoach exposes eight peers at once               | Keep the global choice set small, then allow density only inside a clearly named task workspace.                       |
| 2. Design above the fold                    | Fantrax states the product in one sentence; Sleeper pairs a single offer with one CTA                    | SuperCoach lets branding occupy the first screen while key actions disappear on mobile               | Put route purpose, current state, and the primary action in the first viewport at both target widths.                  |
| 3. Use Hick's Law                           | AFL Fantasy limits entry to AFLW, Classic, or Draft                                                      | SuperCoach's eight sports and Sleeper's expanding product catalogue increase peer choice             | Group Statly league navigation by task and disclose secondary areas only when needed.                                  |
| 4. Encourage scrolling, not excess clicking | Sleeper's mobile discovery becomes a clear vertical story                                                | Carousels hide alternatives; dense tools still require tabs and direct controls                      | Use scrolling for discovery and explanation, but retain fast direct actions in drafts, waivers, scoring, and lineups.  |
| 5. Keep photos authentic                    | AFL Fantasy uses recognizable real players in active sporting poses                                      | Fantrax uses generic rendered athletes; Sleeper uses polished product illustration                   | Keep Statly's real stadium, club, and player imagery; use it selectively around decisions rather than as decoration.   |
| 6. Use visual cues                          | Sleeper combines logos, alignment, score weight, status words, and time                                  | Unlabeled icons and color-only statuses remain likely risks in dense tools                           | Pair icons and color with text labels; make lock, injury, ownership, pick, and live states explicit.                   |
| 7. Keep type legible                        | Fantrax's headline and AFL Fantasy's selector labels remain clear at both widths                         | Sleeper's secondary statistics are small; SuperCoach uses condensed all-caps and clips copy          | Establish a 12px minimum for secondary text and verify dense tables at 200% zoom.                                      |
| 8. Use color deliberately                   | Sleeper's navy/cyan separates surface, action, and selected state; AFL blue reinforces identity          | Competitors use bright accents heavily and cannot prove that state survives without color            | Retain Statly's navy/blue trust palette and semantic status tokens, with text or icons for every meaning.              |
| 9. Design mobile-first                      | AFL Fantasy and Sleeper recompose content and preserve action hierarchy                                  | SuperCoach is the clearest counterexample; Fantrax clips store badges                                | Treat 390px reflow as a release boundary, not a final visual check. Test the owning shell and every task family.       |
| 10. Design for everyone                     | AFL iD and Fantrax expose visible labels and recovery paths; Fantrax has a skip-to-content target in DOM | SuperCoach blocks zoom; screenshots cannot verify keyboard, focus, contrast, or assistive technology | Preserve zoom, semantic landmarks, visible labels, large targets, focus visibility, and redundant state communication. |

## Patterns to adopt

1. **Use a focused mode gateway.** When a user has not entered a league, show the few meaningful paths—join, create, continue, or draft—with AFL Fantasy-style visual differentiation.
2. **Build one strong command surface.** Sleeper's score grid proves that density can work when columns, states, logos, and typography follow one repeatable grammar.
3. **State the offer before the interface.** Fantrax and Sleeper both explain what the product is before asking the user to explore it. Statly's home page needs the same visible promise.
4. **Keep AFL identity real.** Use genuine player, club, stadium, and match context. Avoid generic fantasy illustrations as the dominant product image.
5. **Keep authentication narrow and reassuring.** AFL iD and Fantrax make login a focused detour with visible recovery and registration paths.

## Patterns to avoid

1. **Fixed desktop canvases on mobile.** SuperCoach makes core actions unreachable at 390px; Statly's existing shell failures have the same user impact.
2. **Flat lists of peer navigation.** Eight sports or twelve league tabs force users to parse the whole product before acting.
3. **App-install pressure before value.** App-store badges should not outrank the browser task or clip at narrow widths.
4. **Motion as navigation.** A carousel may market variety, but it should not be the only way to discover a product or preserve state.
5. **Cookie notices that cover the main action.** First-run consent must remain accessible without obscuring the product's core task.

## Recommended order for Statly

1. Fix route-shell and mobile-width ownership across the application.
2. Reduce league navigation to task groups while preserving direct deep links.
3. Give every route a visible purpose, state summary, and primary action above the fold.
4. Define one dense-data grammar for scores, players, rosters, waivers, and draft boards.
5. Keep authentic AFL imagery and semantic color, then repair type size, status redundancy, focus, labels, zoom, and reduced motion.

## Evidence limits and residual risk

- AFL Fantasy Classic/Draft, SuperCoach gameplay, and Fantrax league workspaces require external accounts. No credentials were created or used, so authenticated team, draft, trade, waiver, commissioner, and error states were not audited.
- Sleeper's public live scores and fantasy discovery were accessible, but league creation and mock-draft submission were not performed.
- Screenshots and DOM structure support visible UX and responsive findings; they do not prove WCAG compliance. Keyboard paths, focus trapping/restoration, assistive-technology output, contrast ratios, 200%/400% zoom, reduced-motion behavior, validation, and error recovery still need dedicated testing.
- Product content, seasonal campaigns, live scores, and promotional ordering can change after the audit date.
