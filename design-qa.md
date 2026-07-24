# Statly Trade Centre design QA

## Evidence

- Source visual truth: `/Users/robert/.codex/generated_images/019f8e3e-5181-7851-a392-f40b86cc115a/exec-2b93055c-23c9-4b75-a758-f091222cfba0.png`
- Browser-rendered implementation: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-trade-qa/desktop-wide-final.png`
- Combined comparison: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-trade-qa/comparison-wide-final.png`
- Secondary narrower capture: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-trade-qa/desktop.png`
- Review-alignment source: `/var/folders/5_/s6r1wh5x4tb1r37phv85sw0r0000gn/T/TemporaryItems/NSIRD_screencaptureui_XnnqJi/Screenshot 2026-07-23 at 3.14.33 pm.png`
- Review-alignment implementation: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-review-alignment/review-aligned-1280.png`
- Review-alignment combined comparison: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-review-alignment/alignment-comparison.png`
- Review-alignment mobile capture: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-review-alignment/review-aligned-390.png`
- Route and state: local QA fixture rendering the inbox ledger with two realistic offers; first offer expanded; light theme.
- Viewport: 1280 × 720 CSS px for the primary implementation capture; 764 × 837 CSS px for the narrower capture.
- Pixel dimensions: source 1487 × 1058; primary implementation 1280 × 720; narrower implementation 764 × 837.
- Density normalization: the source was resized to 1280 px wide and top-cropped to 1280 × 720. The implementation remained 1280 × 720. The normalized pair was placed in one 2576 × 720 comparison image with a 16 px divider.
- Review-alignment state: proposal review with one player in each package, no league deadline, 72-hour expiry, and no message. The marked source crop is 2000 × 408 px. The implementation was captured at 1280 × 720 CSS px with a 1280 × 1811 px full-page result, plus a true 390 × 844 CSS px responsive pass. The focused comparison resized the source to 1280 px wide and paired it with the corresponding 1280 px implementation region.

## Full-view comparison evidence

The implemented screen preserves the selected direction's core hierarchy: dark league/governance header, scan-first offer ledger, one expanded offer, explicit send/receive colors, package identity, position/deadline/expiry metadata, normalized category impact, and actions grouped with the active offer. The implementation uses the existing Statly shell and token system instead of reproducing the concept's separate left rail.

The ledger is less dense than the concept only because the deterministic QA fixture contains two offers rather than six. The row and accordion structure supports the denser production state, and automated coverage confirms only one expanded detail panel can exist at a time.

## Focused region comparison evidence

The expanded offer was inspected separately because the full-view comparison makes its small labels difficult to judge. Send and receive packages use clearly distinct amber and teal tokens; the player, club, position, season, and games-played sample remain readable; metadata is aligned in one strip; and the comparison table keeps a high-contrast header with signed, text-labeled outcomes. No target imagery was omitted or substituted: the chosen direction relies on product UI and library icons rather than hero or decorative image assets.

The marked proposal-review region was also compared separately. In the source, the timing summary occupied a narrow right column while the action row sat in a detached full-width footer. In the revised implementation, timing and actions share the same bounded 280–360 px sidebar inside the message card. At 1280 px, the sidebar and primary action both end at x = 1181 exactly. At 390 px, the sidebar and both actions share the same 248 px width and the document has zero horizontal overflow.

## Findings

- No actionable P0, P1, or P2 findings remain.
- [P3] Existing shell differs from the exploratory concept.
  - Location: page-level league navigation.
  - Evidence: the concept includes a permanent navy league rail; Statly's current product shell uses its established league tabs and mobile navigation.
  - Impact: minor visual fidelity difference, without changing the Trade Centre task hierarchy.
  - Fix: retain the current shell unless the full league navigation is redesigned as a separate product-wide project.

## Required fidelity surfaces

- Fonts and typography: existing Statly family and weights are retained. Heading, eyebrow, row-title, metadata, and tabular-number hierarchy match the concept's information density. Long package names truncate in compact rows and remain fully available in expanded details.
- Spacing and layout rhythm: header, ledger controls, compact row, package pair, metadata strip, comparison table, and proposal actions form a consistent vertical sequence. The review message uses Statly's established main-content plus 280–360 px sidebar grid, keeping timing and actions together at desktop and stacked at phone widths. Borders, radii, and elevation use the existing Trade Centre tokens.
- Colors and visual tokens: navy governance surface is retained; amber consistently means send/outgoing; teal consistently means receive/incoming; status, positive, negative, warning, focus, border, and surface colors remain semantic variables.
- Image quality and asset fidelity: no bespoke imagery is required by the selected screen. Existing product marks and Lucide icons remain native assets; no CSS drawings, handcrafted SVG substitutes, or placeholder illustrations were introduced.
- Copy and content: offer titles are package-first; expiry includes an explicit Australian league timezone; comparison basis names the season, averaging model, player count, games-played sample, direction normalization, and limitation that it is not a fairness score.
- Accessibility and behavior: expand controls expose `aria-expanded` and `aria-controls`; focus moves between the ledger and composer workspace; tables keep captions and keyboard-scroll targets; action buttons retain 44 px targets and focus rings.

## Comparison history

1. Initial browser pass found a P1 hydration mismatch: server and client used different implicit locales for offer dates. This produced console errors and could replace the rendered tree on load.
   - Fix: introduced shared deterministic `en-AU` date formatters using `Australia/Melbourne`, then reused them across ledger rows, expanded details, review, and rule summary.
   - Post-fix evidence: a fresh browser reload produced zero new console errors; expiry text matched between server and client and included `AEST`.
2. Initial focused comparison found a P2 copy defect: singular data rendered as “1 categories improve.”
   - Fix: changed the summary to the count-stable form “Categories: 1 improving · 2 declining · 0 even.”
   - Post-fix evidence: the revised browser DOM and final combined comparison show the corrected summary.
3. The marked proposal-review source exposed a P2 alignment issue: timing information was visually separated from its related actions by a full-width footer, and the auto-sized grid exaggerated the gap at wide viewports.
   - Fix: grouped timing and actions in one semantic sidebar using the same bounded 280–360 px grid pattern as other Statly settings panels.
   - Post-fix evidence: the desktop sidebar and primary action share the exact right edge; the 390 px pass has matching component widths, 44 px action targets, and no horizontal overflow.
4. Final close-out review found a P1 multi-team perspective defect: the offer ledger selected the first league team that was not the viewer instead of the trade's actual counterparty. That could show an unrelated team name, and commissioner review of another pair of teams could render empty packages under misleading “You send” and “You receive” labels.
   - Fix: derive both presentation parties exclusively from `trade.memberOne`, `trade.memberTwo`, and the current offer proposer. Participant views retain “You” labels; non-participant commissioner views use the actual team names.
   - Post-fix evidence: regression coverage places an unrelated commissioner team first in the league-team array and proves the ledger still renders the two trade parties and their complete packages. The focused Trade Centre suite passes 116 tests.

## Primary interactions tested

- Expanded the second offer and confirmed the first collapsed, with exactly one comparison panel remaining.
- Opened the proposal workspace from “New proposal” and confirmed the offer ledger was removed from the active workspace.
- Returned with “Back to offers” and confirmed focus moved to the Offers heading.
- Moved from the proposal editor to review with realistic roster selections, then used “Back to edit” and confirmed focus returned to “Review trade.” Re-entering review moved focus to the review heading.
- Checked the revised proposal timing/action group at 1280 × 720 and 390 × 844 CSS px.
- Checked browser console output after the deterministic date-format fix; no new errors were recorded.

## Implementation checklist

- [x] Single, scan-first offer ledger.
- [x] One expanded offer at a time.
- [x] Distinct proposal and offer-history workspaces.
- [x] Semantic send/receive package treatment.
- [x] Honest comparison basis and sample sizes.
- [x] Deterministic league-time date formatting.
- [x] Proposal timing and actions aligned in one responsive sidebar.
- [x] Focus, semantics, and keyboard-scroll behavior.
- [x] Focused tests, lint, type checking, and browser interaction checks.

## Roster table header alignment QA

### Evidence

- User-marked source: `/var/folders/5_/s6r1wh5x4tb1r37phv85sw0r0000gn/T/TemporaryItems/NSIRD_screencaptureui_puCqyA/Screenshot 2026-07-23 at 4.12.40 pm.png`
- Reproduced pre-fix state: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-roster-audit/01-current-roster-table-1130.png`
- Corrected split-workspace state: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-roster-audit/02-corrected-roster-table-1130.png`
- Corrected wide-screen state: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-roster-audit/03-corrected-roster-table-2000.png`
- Combined before/after comparison: `/Users/robert/Documents/Codex/2026-07-23/files-mentioned-by-the-user-1/work/statly-roster-audit/roster-header-comparison.png`
- Viewports: 1130 × 1022 CSS px for the split proposal workspace and 2000 × 1022 CSS px for the wide workspace.

### Goal and findings

The roster table's goal is fast, trustworthy player comparison: the identity column must scan as one left-aligned unit, each statistic heading must share its numeric column's alignment edge, and sorting must be discoverable without adding noise to every header.

- No actionable P0, P1, or P2 findings remain.
- The pre-fix Player label began about 125 px to the right of the player identity content, making it appear detached from its column.
- Every numeric heading ended 4 px to the left of the values beneath it because the interactive sort wrapper added padding that the data cells did not share.
- Inactive headings displayed em-dash placeholders, creating a second visual token in every category despite having no state or interaction meaning.

### Resolution and measured result

- The Player sort control now uses the same leading alignment as player identity cells, including the sticky column boundary. At 1130 px, both begin at x = 119 px.
- Numeric headers and row values now use one shared right edge. G, T, I50, I, CM, R50, CP, ED, and SI each measured a 0 px header-to-value delta at the 2000 px viewport.
- Only the active sort receives an arrow icon. Inactive headings have no dash and no icon, while their full meaning and next action remain available in the accessible name.
- Sorting I50 transferred the single visible icon and `aria-sort="descending"` state from Player to I50; restoring Player returned the table to its initial A–Z state.
- The page retained zero horizontal document overflow at both verification widths; narrower roster cards continue to contain the table's horizontal scrolling.

### Required fidelity surfaces

- Typography, abbreviations, row density, semantic colors, team marks, borders, and existing table sizing were preserved.
- The change uses existing token-based utilities and Lucide icons; no new dependency, custom CSS primitive, hard-coded color, or decorative asset was introduced.
- Keyboard operation, focus styling, `aria-sort`, descriptive sort labels, sticky identity cells, empty values, and selection controls remain intact.

## Follow-up polish

- Consider adding the 1130 × 1022 roster workspace to the project's automated visual-regression suite; the manual before/after comparison now provides the baseline.

final result: passed

## Final send checkpoint QA

### Goal

The final confirmation must make submission deliberate and truthful: the manager can identify the recipient, both complete packages, effective expiry, league deadline, and the exact acceptance path immediately beside the final action. The review page is the confirmation step; no additional modal is introduced.

### Evidence

- Approved reference: `/var/folders/5_/s6r1wh5x4tb1r37phv85sw0r0000gn/T/TemporaryItems/NSIRD_screencaptureui_Wb5qeA/Screenshot 2026-07-23 at 5.46.31 pm.png`
- Tablet implementation: `/Users/robert/Developer/Statly/output/trade-checkpoint-qa/checkpoint-1024-viewport.png`
- Mobile checkpoint: `/Users/robert/Developer/Statly/output/trade-checkpoint-qa/checkpoint-390-viewport.png`
- Mobile actions: `/Users/robert/Developer/Statly/output/trade-checkpoint-qa/checkpoint-390-actions.png`
- Compact-mobile actions: `/Users/robert/Developer/Statly/output/trade-checkpoint-qa/checkpoint-320-actions.png`
- Route and state: isolated `e2e-completed-league` fixture; Robbo Rockers sends Darcy Cameron and receives Zach Merrett from AFL Legends; immediate-completion policy, 72-hour expiry, no league deadline.

### Findings and resolution

- No actionable P0, P1, or P2 visual or interaction findings remain.
- The approved hierarchy is preserved with Statly's semantic tokens: dark checkpoint header, recipient-led question, four-fact definition list, consequence notice, and paired final actions.
- The implementation generalizes the one-player reference to complete multi-player lists and allows long player, club, and team names to wrap without clipping.
- Rule copy is derived from the same acceptance-path classification used by server transition policy. Immediate, commissioner, and veto paths have focused automated coverage.
- Expiry states the configured duration and, when applicable, that the league deadline can end the offer first.
- The comparison now uses `Favours incoming` and `Favours outgoing`, avoiding an unsupported fairness or projected-lineup claim.
- Zero-only position changes render as `No positional balance change`; mixed packages omit meaningless zero badges.

### Responsive and accessibility evidence

- Automated Chromium journey passed at 1920 × 1000, 1440 × 1000, 1024 × 900, 390 × 844, and 320 × 800 CSS px.
- Direct browser measurement found zero document overflow and zero clipped checkpoint text/actions at 1024, 390, and 320 px.
- At 1024 px the two actions measured 405 × 44 px; at 390 px they stacked at 248 × 44 px; at 320 px they stacked at 178 × 44 px.
- The checkpoint exposes the ordered terms `You send`, `You receive`, `Expires`, and `Deadline`; the recipient heading receives focus on entry.
- The 320 px pass provides the effective reflow evidence for a 1280 px layout at 400% zoom. Content stacks instead of requiring two-dimensional page scrolling.
- Back-to-edit restores the draft and focus, while pending submission disables mutation controls and remains recipient-specific.
- The browser console recorded no client errors during the checkpoint pass.

### Residual risk

League settings can change while review remains open. The displayed copy is a snapshot, while submission and completion continue to use current server validation. Strict UI rule locking would require versioned rule submissions and remains outside this presentation change.

final result: passed
