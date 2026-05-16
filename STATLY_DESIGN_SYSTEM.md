# Statly Design System

## 1. Goal

Statly is not trying to look like a generic SaaS dashboard. The product goal is to become the most trusted AFL fantasy companion in Australia by combining:

- ESPN Fantasy's structure, information hierarchy, and roster-management clarity
- SuperCoach's AFL-specific statistical depth
- Yahoo Fantasy's usability, polish, and mobile flow quality

This document exists to make that goal concrete. It defines how Statly should look, behave, and be reviewed so contributors can make decisions that move the product toward that standard instead of drifting into one-off UI choices.

## 2. What The Previous Version Got Wrong

The earlier design-system document had the right intent but missed the product goal in several important ways:

- It was mostly a token catalog, not a product design standard.
- It described generic frontend good practice, but not what makes a strong fantasy-sports interface.
- It did not explain how to balance dense data with speed and clarity.
- It lacked patterns for Statly's most important surfaces: roster pages, player tables, draft boards, live scoring, and trade flows.
- It leaned on hard-coded palette examples instead of semantic token guidance aligned with the codebase rules.
- It did not give reviewers a strong framework for deciding whether a design change actually improves the product.

This rewrite corrects those gaps.

## 3. Product Design Standard

Every Statly UI should support four outcomes:

### 3.1 Fast Decisions

Users should be able to answer critical fantasy questions quickly:

- Who should I start?
- Who is trending up or down?
- What changed since I last checked?
- What is the best move I can make right now?

Design implication:

- Prioritize scanability over decoration.
- Put the most decision-relevant information first.
- Reduce friction between overview and action.

### 3.2 High Trust

Fantasy users rely on the product to make competitive decisions. The interface must feel credible, current, and stable.

Design implication:

- Important stats, statuses, and timestamps must be clear.
- Empty, loading, and error states must feel intentional, not broken.
- Layout shifts, ambiguous labels, and noisy styling erode trust.

### 3.3 AFL-Specific Depth Without Clutter

Statly should embrace AFL complexity, but never present it in the cluttered way common to older fantasy products.

Design implication:

- Dense information is acceptable when grouped, ranked, and chunked well.
- Secondary metrics should support the primary story, not compete with it.
- Progressive disclosure should be used for advanced details.

### 3.4 Mobile-Ready Team Management

Users must be able to manage a roster, review live scoring, and make decisions comfortably on mobile.

Design implication:

- Mobile is not a reduced desktop view.
- Key actions must remain visible and reachable on small screens.
- Tables and draft surfaces need mobile-specific layouts, not simple shrink-to-fit behavior.

## 4. Core Design Principles

### 4.1 Structure Before Style

Statly should win on layout clarity before visual flourish. A good screen makes the hierarchy obvious at a glance:

- primary action
- current state
- most important stats
- supporting context

If a screen needs heavy visual treatment to feel understandable, the structure is probably weak.

### 4.2 Dense But Legible

Fantasy interfaces are naturally information-dense. Density is acceptable when:

- rows align cleanly
- labels are short and consistent
- key values are visually emphasized
- supporting values are quieter
- spacing creates grouping without wasting space

Do not confuse spaciousness with usability. Serious users will tolerate density; they will not tolerate confusion.

### 4.3 Consistent Interaction Models

The same actions should behave the same way across the product:

- row actions
- filters
- sorting
- tabs
- dialogs
- status badges
- inline validation

Avoid feature-specific interaction inventions unless the existing model clearly fails.

### 4.4 Semantic Theming

The codebase should use semantic tokens and shadcn-style primitives, not one-off color decisions.

Prefer:

- `bg-background`
- `text-foreground`
- `text-muted-foreground`
- `border-border`
- `bg-card`
- `ring-ring`
- state tokens already established in the codebase

Avoid hard-coded color values in component markup unless a documented brand rule requires them.

### 4.5 Accessibility Is A Product Requirement

Accessibility is not a cleanup pass. It is part of the quality bar:

- keyboard support must remain intact
- focus visibility must be obvious
- color cannot be the only signal
- icon-only controls need accessible names
- data-heavy views still need clear semantics

## 5. Visual Language

### 5.1 Tone

Statly should feel:

- modern
- authoritative
- efficient
- data-rich
- sport-aware without becoming noisy or gimmicky

Avoid:

- casino-like energy
- overly playful gamification cues
- generic enterprise blandness
- cluttered sports-broadcast styling

### 5.2 Colour Usage

Colour should clarify status, emphasis, and hierarchy rather than decorate every surface.

Rules:

- Base surfaces should remain neutral and token-driven.
- Accent colour should draw attention to action and priority, not every card.
- Positive, warning, and negative states must remain semantically consistent.
- Team colours and AFL branding cues should be controlled accents, not the app-wide base palette.

Use colour to answer:

- What should I click?
- What changed?
- Is this good, risky, or bad?

Do not use colour only to make a surface feel "exciting."

### 5.3 Typography

Typography should support quick scanning in dense interfaces.

Rules:

- Page titles should orient the user immediately.
- Section headings should separate tasks or data groups, not merely fill space.
- Body text should stay readable at high data density.
- Numeric values should be easy to compare in rows and cards.
- Helper text should remain visually secondary.

Typography should create obvious distinction between:

- labels
- values
- metadata
- status
- action text

## 6. Layout Rules

### 6.1 Page Structure

Most product pages should follow this order:

1. Page identity: title, context, season/week/league state
2. Immediate actions: the next high-value move
3. Primary information block: roster, matchup, draft, rankings, or player list
4. Supporting analysis: trends, projections, insights, alerts
5. Secondary utilities: settings, admin actions, low-priority metadata

### 6.2 Desktop Layout

Desktop layouts should use the available width to improve comparison and scanning, not just increase whitespace.

Good desktop behavior:

- multiple panes when comparison matters
- sticky headers or controls for long data views
- visible filters near the table or content they affect
- summary metrics kept near the surface they explain

### 6.3 Mobile Layout

Mobile layouts should preserve task completion, not just content availability.

Good mobile behavior:

- top actions remain reachable
- summary state appears before heavy detail
- tables collapse into structured cards only when comparison still works
- actions stay near the affected content
- sticky bottom actions are acceptable for key flows

Bad mobile behavior:

- forcing horizontal scroll for core tasks
- burying actions below long metric lists
- hiding critical context behind multiple taps

## 7. Component And Surface Standards

### 7.1 Tables

Tables are central to Statly. They should feel closer to ESPN in structure, but cleaner.

Requirements:

- sorting, filtering, and column labeling must be obvious
- numeric comparison should be easy
- status indicators must not overpower row content
- sticky headers should be used when row volume is high
- loading, empty, and error states must preserve the table's footprint and intent

For large stat tables:

- prioritize the most decision-relevant columns
- group advanced metrics behind progressive disclosure if needed
- preserve alignment and column rhythm
- virtualize when scale requires it

### 7.2 Player Cards

Player cards should summarize action-worthy information, not become mini dashboards.

A strong player card usually includes:

- player identity
- position and team context
- current status
- 1 to 3 key fantasy signals
- one obvious action path

Avoid cramming every available metric into the card. If the card cannot be scanned in seconds, it is doing too much.

### 7.3 Draft Boards

Draft boards are a signature surface and should feel premium.

Requirements:

- current pick, upcoming turns, and user queue must be immediately visible
- urgency should be clear without panic styling
- available-player evaluation must remain readable during live updates
- mobile should preserve pick awareness and action speed

Design goal:

- high energy
- low chaos

### 7.4 Live Scoring And Matchup Views

These surfaces must support repeat checking and quick interpretation.

Requirements:

- score deltas and momentum should be glanceable
- timestamps or update indicators should reinforce trust
- positive and negative movement should be visually distinct but not overwhelming
- roster slots and scoring contributors should remain easy to parse on mobile

### 7.5 Forms And Setup Flows

League creation, roster edits, and trade actions should feel guided and low-risk.

Requirements:

- labels must be explicit
- defaults should be sensible
- destructive or irreversible actions should be clear
- validation should appear where the user can correct it immediately
- advanced configuration should be available without overwhelming first-time users

### 7.6 Dashboards

Dashboards should help users decide what to do next, not just show that data exists.

Good dashboard content:

- current league state
- urgent actions
- relevant trends
- recent changes
- shortcuts into deeper workflows

Avoid filling dashboards with low-value summary cards that repeat information from elsewhere.

## 8. Motion And Feedback

Motion should support orientation, not spectacle.

Use motion for:

- entering and exiting overlays
- confirming state change
- helping users track live updates
- guiding attention to changed content

Rules:

- keep durations restrained
- respect `prefers-reduced-motion`
- avoid decorative animation loops
- never let motion slow down a time-sensitive action

## 9. Accessibility Requirements

Statly targets WCAG 2.1 AA at minimum.

Every design and implementation should preserve:

- keyboard accessibility for every interactive element
- visible focus states
- accessible names for controls
- correct associations for help text and errors
- sufficient contrast in light and dark modes
- non-color indicators for important state

For data-rich surfaces:

- use semantic tables when tabular relationships matter
- ensure sortable controls are announced clearly
- keep screen-reader order aligned with visual order

## 10. Performance Expectations

Perceived speed is part of the design quality bar.

Design decisions should support:

- fast initial comprehension
- stable layout during loading
- optimized imagery and media
- sensible lazy-loading of non-critical assets
- scalable rendering for large datasets

A beautiful interface that stalls under live data load fails the design goal.

## 11. Review Standard

Design review should answer one question:

Does this change move Statly closer to being a trusted, high-clarity, AFL-first fantasy platform?

Reviewers should assess changes against these criteria.

### 11.1 Product Fit

- Does the screen help users make a fantasy decision faster?
- Does it feel closer to ESPN's structure, SuperCoach's depth, and Yahoo's usability?
- Does it maintain a distinct Statly identity instead of copying any one benchmark directly?

### 11.2 Clarity

- Is the information hierarchy obvious?
- Is the most important action clear?
- Is dense information still easy to scan?

### 11.3 Consistency

- Does it match existing shadcn and repo patterns?
- Does it reuse existing tokens and components?
- Does it avoid feature-specific styling drift?

### 11.4 Accessibility

- Can the feature be completed by keyboard?
- Are labels, focus, and status communication clear?
- Does the design hold up in both themes?

### 11.5 Responsiveness

- Is the mobile layout truly usable for the core task?
- Does desktop use space to improve comparison and speed?
- Do key actions remain accessible at all sizes?

### 11.6 Performance

- Will the design remain usable under real data volume?
- Does it avoid unnecessary visual or rendering cost?
- Are long lists, images, and live updates handled responsibly?

## 12. PR Evidence Requirements

Non-trivial design-affecting changes should include:

- before and after screenshots, or a short demo video
- desktop and mobile views
- light and dark mode if both are supported on the surface
- notes on accessibility-sensitive changes
- notes on new patterns introduced, if any

For major UX changes, reviewers should also compare the resulting flow to the relevant benchmark experience:

- ESPN for structure and navigation
- SuperCoach for fantasy-stat depth
- Yahoo for trade, mobile, and draft usability

## 13. Implementation Rules For Contributors

When changing UI:

- follow existing file and component patterns first
- prefer composition over custom wrappers
- use semantic tokens instead of hard-coded colors
- preserve backwards compatibility unless the task explicitly allows otherwise
- make the smallest change that fully solves the problem

When adding a new pattern:

- prove that an existing pattern does not already solve the need
- document the pattern here if it will be reused
- ensure accessibility and responsiveness are part of the pattern, not follow-up work

## 14. Design System Maintenance

This document is the standard for future design decisions. It should be updated when:

- a new reusable product pattern is introduced
- review criteria need clarification
- a core surface evolves significantly
- the design system adds a truly new token or component convention

It should not be updated for one-off implementation details, temporary workarounds, or isolated styling preferences.

## 15. Definition Of Done For Design

A design-affecting change is done only when:

- the requested behavior is implemented
- the result aligns with Statly's product bar
- accessibility is preserved or improved
- responsive behavior is verified
- relevant checks pass
- the change avoids unnecessary complexity
- the UI feels intentional under realistic data conditions

If a change is technically correct but weakens clarity, trust, or usability, it is not done.
