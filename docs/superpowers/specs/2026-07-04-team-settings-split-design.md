# Team Settings Split Design

## Goal

Separate personal team configuration from commissioner league configuration on the league detail page.

## Product Shape

League members get a dedicated `Team Settings` tab. It is visible to every active league member and owns member-specific preferences for that league:

- Team name.
- Team identity image, upload, crop position, and zoom.
- League-specific notification preferences.

Commissioners and managers get a separate `League Settings` tab. It owns league-level controls only:

- League name, code, capacity, and fill state.
- Scoring categories.
- Draft settings.
- Roster settings.
- Auto-pick and waiver settings.

Ordinary members should not see the `League Settings` tab. They should still be able to edit `Team Settings`.

## Data Ownership

Team settings persist through the existing member route:

- `PATCH /api/leagues/[id]/members/me`

The route already authenticates the current user, checks league membership, and persists team identity fields. It should be extended to accept:

- `teamName`
- `notificationSettings.tradePush`
- `notificationSettings.waiverPush`
- `notificationSettings.draftReminder`
- `notificationSettings.scoringAlerts`

League settings continue to persist through:

- `GET /api/leagues/[id]/settings`
- `PUT /api/leagues/[id]/settings`

The league settings panel should no longer contain team identity fields.

## UI Behavior

The tab list should include:

- `Overview`
- `Teams`
- `My Roster`
- `Trades`
- `Waivers`
- `Draft`
- `Team Settings`
- `League Settings` for commissioners/managers only

If a non-commissioner lands on `?tab=settings`, the page should fall back to `overview` or `team-settings` rather than rendering commissioner controls.

`Team Settings` should render as one page with three sections:

1. `Team details`
   - `Team name` input.
   - Save action.

2. `Team identity`
   - Existing large image preview.
   - Existing URL, upload, clear, zoom, horizontal centre, and vertical centre controls.

3. `Notifications`
   - Four accessible checkboxes:
     - Trade offers
     - Waiver updates
     - Draft reminders
     - Scoring alerts

## Test Strategy

Add focused coverage at the ownership boundary:

- Ordinary members see `Team Settings` and do not see `League Settings`.
- Commissioners see both tabs.
- Team identity remains editable from `Team Settings`.
- Team name and notification preferences save to `/api/leagues/[id]/members/me`.
- `League Settings` no longer contains `Team identity`.
- The member route accepts team name and notification settings after membership authorization.

Browser verification should cover:

- Ordinary member route with `?tab=team-settings`.
- Commissioner route with `?tab=league-settings`.
- Legacy `?tab=settings` behavior.
