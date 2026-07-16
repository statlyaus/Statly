# League Competition Rules

## Purpose

These rules define how a Statly fantasy AFL league is configured, published, played, and audited. They are the source of truth for league settings, fixture generation, lineup locking, interchange autosubs, standings, finals, and commissioner overrides.

## Roles and Publication

- A league supports 4 to 18 teams.
- The owner can appoint up to three co-commissioners. Commissioners have the same competition-management authority as the owner.
- Commissioners configure a competition before publication. Publication records an immutable rules snapshot and fixture version.
- Members can prepare lineups before official AFL fixture data is complete. The competition is shown as **Published but pending** until the missing data arrives.
- A commissioner override is recorded in the league activity log and notifies members in-app. Email is sent only to members who have enabled league email notifications.

## Fantasy Calendar and Fixtures

- The commissioner selects the AFL round that starts the fantasy season, the number of regular-season fantasy rounds, and the finals structure.
- Fantasy rounds are distinct from AFL rounds. A commissioner can exclude an AFL round, which remains a numbered fantasy **no-matchup week**. No matchup or scoring is produced for that week, and the next playable fixture keeps its original fantasy-round number.
- Automatic fixtures use the circle-method round robin. With an even number of teams, every selected fantasy round contains a matchup for every team. With an odd number of teams, every team receives one fantasy bye per complete cycle.
- The system rejects an odd-team regular-season length that cannot distribute byes equally and explains the valid lengths to commissioners.
- For a partial even-team season, the generator uses the requested number of sequential fixture sets from the round-robin cycle. Repeated cycles repeat the same opponent sequence.
- A fantasy bye is a no-matchup week. It is not a win, draw, or loss.
- An AFL club bye is separate: the fantasy matchup continues, but players from the club are marked **No game**.
- Commissioners can inspect and edit every fixture. An edit to a published fixture invalidates affected lineups and results, recalculates standings, reseeds finals, rewrites unplayed finals fixtures, and records the override. Completed finals remain in the audit history.

## Finals

- Commissioners can enable 4, 6, or 8-team finals.
- Four-team finals: `1 v 4` and `2 v 3`; winners play in the final.
- Six-team finals: Week 1 is `3 v 6` and `4 v 5`. Week 2 is `1 v winner of 4 v 5` and `2 v winner of 3 v 6`; winners play in the final.
- Eight-team finals follow the AFL-style top-eight structure. Week 1 is `1 v 4`, `2 v 3`, `5 v 8`, and `6 v 7`. The qualifying-final winners receive a week off; qualifying-final losers meet elimination-final winners in Week 2; Week 3 determines the finalists.
- A drawn final is decided by the higher regular-season seed. There is no drawn premiership.

## Standings and Tie-Breaks

- Weekly draws are recorded in both the matchup record and category record.
- Commissioners choose one enabled fantasy category as the standings tie-break metric.
- Teams are ranked by matchup record, then the chosen season-long category total, then original draft seed. This gives every published competition a deterministic order.

## Lineups, Locks, and Saving

- Active scoring slots are `DEF`, `MID`, `RUC`, `FWD`, and optional `UTIL` slots.
- `INTERCHANGE` is separate from active scoring and is commissioner-configurable. Interchange players are ordered autosub candidates.
- A lineup can be incomplete. Each insert, move, or removal autosaves. The UI exposes `Saving`, `Saved`, `Unsaved changes`, `Save failed`, and `Locked` states as applicable.
- The latest saved lineup carries into the next playable fantasy round. It also carries across a no-matchup week until changed.
- The default lock policy is **Individual AFL game start**. A player locks at the official start time of their AFL match; locked players cannot be moved, removed, or replaced manually.
- The alternative policy is a Thursday 7:00 pm AEST round deadline. Commissioners can select an alternate league timezone.
- Official fixture changes automatically update an unlocked player lock time. A player with no reliable official game start remains unlocked and the round remains published but pending.
- If fixture data has been pending for 24 hours, all commissioners are notified. Before the first scheduled AFL game, they can set a round-wide fallback deadline. Individual manual player deadlines are not supported.

## Interchange Autosubs

- An AFL club bye and a player confirmed not to have participated in a completed AFL match both qualify as non-playing.
- Autosubs resolve only after the whole AFL round is complete.
- Candidates are considered in `INTERCHANGE 1`, `INTERCHANGE 2`, then `INTERCHANGE 3` order. A non-playing interchange candidate is skipped. If no candidate is available, the active slot remains a zero.
- The first eligible interchange player replaces the next eligible non-playing active player using the stable active-slot order `DEF`, `MID`, `RUC`, `FWD`, then `UTIL`.
- The replacement moves into the active slot and contributes their score once. The non-playing player moves to the interchange slot. Interchange players lock at their own AFL game start.
- A manager can manually place an unlocked interchange player in an active slot; doing so removes that player from autosub priority.
- Autosub decisions are persisted and shown in the activity log with the original slot, replacement, rule reason, and resolution time.

## AFL Fixture Data

The AFL fixture integration must provide, for the configured season window:

- AFL round and match identifier;
- participating clubs;
- scheduled start time in UTC;
- match status and finality;
- player participation or a definitive no-participation signal; and
- last-updated timestamp.

Publication is allowed while this information is outstanding. The commissioner preflight must show what is configured, what is pending, and the applicable lock behavior.

## Member-Facing Rules

Every league exposes a read-only League Rules page with the published configuration, fixture version, lock policy, finals bracket, tie-break metric, override history, and worked examples for an autosub, fantasy bye, AFL club bye, drawn final, and commissioner override.
