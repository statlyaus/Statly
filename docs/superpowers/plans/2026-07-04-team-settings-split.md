# Team Settings Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split personal team configuration into a member-visible `Team Settings` tab while keeping commissioner-only controls in `League Settings`.

**Architecture:** Keep league-level data on `/api/leagues/[id]/settings`. Move member-owned UI state into a new `TeamSettingsPanel` in `src/components/league/LeagueTabs.tsx`, backed by the existing `/api/leagues/[id]/members/me` route extended for `teamName` and `notificationSettings`.

**Tech Stack:** Next.js App Router, React client component state, TypeScript, Vitest, Testing Library, existing `authenticatedFetch`, existing Prisma/Firestore membership bridge.

---

## File Structure

- Modify `src/components/league/LeagueTabs.tsx`
  - Add `team-settings` and `league-settings` tab ids.
  - Show `Team Settings` to all active members.
  - Show `League Settings` only to commissioners/managers.
  - Extract team name, identity, and notifications into a new `TeamSettingsPanel`.
  - Leave league-level settings in `LeagueSettingsPanel`.

- Modify `src/app/api/leagues/[id]/members/me/route.ts`
  - Extend `PATCH` parsing to accept `teamName` and `notificationSettings`.
  - Persist supported fields to Prisma or Firestore using existing membership authorization.
  - Return the updated member envelope.

- Modify `src/types/leagues.ts`
  - Add a reusable notification settings type and optional `notificationSettings` to `LeagueMember` and `LeagueMemberDoc`.

- Modify `tests/unit/LeagueTabs.teamIdentity.test.tsx`
  - Point the mocked tab to `team-settings`.
  - Add expectations for `Team Settings`, team name, and notification saves.

- Modify `tests/unit/leagueSettingsUiArchitecture.test.ts`
  - Assert league settings no longer contain team identity.
  - Assert tab visibility and route ownership strings.

- Modify `tests/unit/leagueMemberIdentityRouteArchitecture.test.ts`
  - Assert route accepts and persists `teamName` and `notificationSettings`.

## Task 1: Add Types And Route Support

**Files:**
- Modify: `src/types/leagues.ts`
- Modify: `src/app/api/leagues/[id]/members/me/route.ts`
- Test: `tests/unit/leagueMemberIdentityRouteArchitecture.test.ts`

- [ ] **Step 1: Write the route architecture expectations**

Add assertions to `tests/unit/leagueMemberIdentityRouteArchitecture.test.ts`:

```ts
it('updates team name and notification settings on the member settings route', () => {
  const route = source();

  expect(route).toContain('parseTeamName(body.teamName)');
  expect(route).toContain('parseNotificationSettings(body.notificationSettings)');
  expect(route).toContain('teamName,');
  expect(route).toContain('notificationSettings,');
  expect(route).toContain('tradePush');
  expect(route).toContain('waiverPush');
  expect(route).toContain('draftReminder');
  expect(route).toContain('scoringAlerts');
});
```

- [ ] **Step 2: Run the route architecture test and verify it fails**

Run:

```bash
npm run test:unit -- tests/unit/leagueMemberIdentityRouteArchitecture.test.ts
```

Expected: FAIL because `parseTeamName` and `parseNotificationSettings` do not exist yet.

- [ ] **Step 3: Add member notification types**

In `src/types/leagues.ts`, add:

```ts
export interface LeagueMemberNotificationSettings {
  tradePush: boolean;
  waiverPush: boolean;
  draftReminder: boolean;
  scoringAlerts: boolean;
}
```

Then add this optional field to both `LeagueMemberDoc` and `LeagueMember`:

```ts
notificationSettings?: LeagueMemberNotificationSettings;
```

- [ ] **Step 4: Extend the member settings route parser**

In `src/app/api/leagues/[id]/members/me/route.ts`, add helper functions above `PATCH`:

```ts
const DEFAULT_NOTIFICATION_SETTINGS = {
  tradePush: true,
  waiverPush: true,
  draftReminder: true,
  scoringAlerts: true,
};

function parseTeamName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('Team name must be text.');
  }
  const teamName = value.trim();
  if (teamName.length < 2) {
    throw new Error('Team name must be at least 2 characters.');
  }
  if (teamName.length > 40) {
    throw new Error('Team name must be 40 characters or fewer.');
  }
  return teamName;
}

function parseNotificationSettings(value: unknown) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Notification settings must be an object.');
  }

  const input = value as Record<string, unknown>;
  return {
    tradePush:
      typeof input.tradePush === 'boolean'
        ? input.tradePush
        : DEFAULT_NOTIFICATION_SETTINGS.tradePush,
    waiverPush:
      typeof input.waiverPush === 'boolean'
        ? input.waiverPush
        : DEFAULT_NOTIFICATION_SETTINGS.waiverPush,
    draftReminder:
      typeof input.draftReminder === 'boolean'
        ? input.draftReminder
        : DEFAULT_NOTIFICATION_SETTINGS.draftReminder,
    scoringAlerts:
      typeof input.scoringAlerts === 'boolean'
        ? input.scoringAlerts
        : DEFAULT_NOTIFICATION_SETTINGS.scoringAlerts,
  };
}
```

- [ ] **Step 5: Persist team name and notifications**

Inside `PATCH`, after body parsing and before team logo parsing, add:

```ts
let teamName: string | undefined;
let notificationSettings:
  | {
      tradePush: boolean;
      waiverPush: boolean;
      draftReminder: boolean;
      scoringAlerts: boolean;
    }
  | undefined;

try {
  teamName = parseTeamName(body.teamName);
  notificationSettings = parseNotificationSettings(body.notificationSettings);
} catch (error) {
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: 'Invalid team settings' }, { status: 400 });
}
```

Update the Prisma `data` object to:

```ts
data: {
  ...(teamName !== undefined && { teamName }),
  teamLogoUrl,
  teamLogoPositionX,
  teamLogoPositionY,
  teamLogoZoom,
  ...(notificationSettings !== undefined && { notificationSettings }),
},
```

Add `notificationSettings: true` to the Prisma `select` block.

Update the Firestore patch to:

```ts
queueLeagueMembershipPatch(batch, id, userId, {
  ...(teamName !== undefined && { teamName }),
  teamLogoUrl,
  teamLogoPositionX,
  teamLogoPositionY,
  teamLogoZoom,
  ...(notificationSettings !== undefined && { notificationSettings }),
});
```

Include `teamName` and `notificationSettings` in both response member envelopes.

- [ ] **Step 6: Run route tests**

Run:

```bash
npm run test:unit -- tests/unit/leagueMemberIdentityRouteArchitecture.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit route support**

Run:

```bash
git add src/types/leagues.ts 'src/app/api/leagues/[id]/members/me/route.ts' tests/unit/leagueMemberIdentityRouteArchitecture.test.ts
git commit -m "Add member team settings route fields"
```

## Task 2: Split Tabs And Move Team Settings UI

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`
- Test: `tests/unit/leagueSettingsUiArchitecture.test.ts`

- [ ] **Step 1: Write architecture assertions**

Update `tests/unit/leagueSettingsUiArchitecture.test.ts`:

```ts
it('splits member team settings from commissioner league settings', () => {
  const leagueTabsSource = source();

  expect(leagueTabsSource).toContain("'team-settings'");
  expect(leagueTabsSource).toContain("'league-settings'");
  expect(leagueTabsSource).toContain("name: 'Team Settings'");
  expect(leagueTabsSource).toContain("name: 'League Settings'");
  expect(leagueTabsSource).toContain('const tabs: Tab[] = baseTabs');
  expect(leagueTabsSource).toContain('isAdmin ? [...baseTabs, leagueSettingsTab] : baseTabs');
  expect(leagueTabsSource).toContain('<TeamSettingsPanel');
  expect(leagueTabsSource).toContain('<LeagueSettingsPanel');
});

it('keeps team-owned controls out of commissioner league settings', () => {
  const leagueTabsSource = source();
  const teamPanelIndex = leagueTabsSource.indexOf('function TeamSettingsPanel');
  const leaguePanelIndex = leagueTabsSource.indexOf('function LeagueSettingsPanel');

  expect(teamPanelIndex).toBeGreaterThan(-1);
  expect(leaguePanelIndex).toBeGreaterThan(-1);
  expect(teamPanelIndex).toBeLessThan(leaguePanelIndex);
  expect(leagueTabsSource.indexOf('Team identity')).toBeLessThan(leaguePanelIndex);
  expect(leagueTabsSource.indexOf('Save league settings')).toBeGreaterThan(leaguePanelIndex);
});
```

- [ ] **Step 2: Run the architecture test and verify it fails**

Run:

```bash
npm run test:unit -- tests/unit/leagueSettingsUiArchitecture.test.ts
```

Expected: FAIL because tab ids and `TeamSettingsPanel` do not exist.

- [ ] **Step 3: Add tab ids**

In `src/components/league/LeagueTabs.tsx`, change:

```ts
type TabType = 'overview' | 'teams' | 'roster' | 'trades' | 'waivers' | 'draft' | 'settings';
```

to:

```ts
type TabType =
  | 'overview'
  | 'teams'
  | 'roster'
  | 'trades'
  | 'waivers'
  | 'draft'
  | 'team-settings'
  | 'league-settings'
  | 'settings';
```

Keep `settings` temporarily as a legacy URL alias.

- [ ] **Step 4: Normalize legacy settings route**

Update `getLeagueTabFromSearch` so `settings` maps to the right tab:

```ts
function getLeagueTabFromSearch(value: string | null, isAdmin = false): TabType | null {
  if (value === 'settings') return isAdmin ? 'league-settings' : 'team-settings';
  return isLeagueTab(value) ? value : null;
}
```

Update callers to pass `isAdmin` after `currentMember` is known. The initial state can keep `overview`; the existing effect will select the right tab once membership is resolved.

- [ ] **Step 5: Replace the tab list**

Replace the current `tabs` constant with:

```ts
const baseTabs: Tab[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'teams', name: 'Teams' },
  { id: 'roster', name: 'My Roster' },
  { id: 'trades', name: 'Trades' },
  { id: 'waivers', name: 'Waivers' },
  { id: 'draft', name: 'Draft' },
  { id: 'team-settings', name: 'Team Settings' },
];
const leagueSettingsTab: Tab = { id: 'league-settings', name: 'League Settings' };
const tabs: Tab[] = isAdmin ? [...baseTabs, leagueSettingsTab] : baseTabs;
```

- [ ] **Step 6: Add panel rendering boundaries**

Replace the current settings rendering block with:

```tsx
{activeTab === 'team-settings' && (
  <TeamSettingsPanel
    league={league}
    currentUserId={currentUserId}
    currentMember={currentMember}
    onMemberChange={(nextMember) => {
      const nextMembers = members.map((member) =>
        member.id === nextMember.id ? { ...member, ...nextMember } : member
      );
      onMembersChange?.(nextMembers);
    }}
  />
)}

{activeTab === 'league-settings' && isAdmin && (
  <LeagueSettingsPanel
    league={league}
    memberCount={members.length}
    isAdmin={isAdmin}
    isActive
    currentUserId={currentUserId}
  />
)}
```

- [ ] **Step 7: Extract TeamSettingsPanel**

Move the existing team identity state and handlers from `LeagueSettingsPanel` into a new `TeamSettingsPanel` placed before `LeagueSettingsPanel`. Its props should be:

```ts
function TeamSettingsPanel({
  league,
  currentUserId,
  currentMember,
  onMemberChange,
}: {
  league: League;
  currentUserId?: string;
  currentMember?: LeagueMember;
  onMemberChange?: (member: LeagueMember) => void;
}) {
  // team name, identity, notification state
}
```

Keep the existing team identity JSX unchanged except for section title copy if needed.

- [ ] **Step 8: Remove team identity props from LeagueSettingsPanel**

Remove these props from `LeagueSettingsPanel`:

```ts
currentMember?: LeagueMember;
onMemberIdentityChange?: (member: LeagueMember) => void;
```

Remove all team symbol state, upload handlers, and identity JSX from `LeagueSettingsPanel`.

- [ ] **Step 9: Run architecture test**

Run:

```bash
npm run test:unit -- tests/unit/leagueSettingsUiArchitecture.test.ts
```

Expected: PASS.

## Task 3: Add Team Name And Notification UI

**Files:**
- Modify: `src/components/league/LeagueTabs.tsx`
- Test: `tests/unit/LeagueTabs.teamIdentity.test.tsx`

- [ ] **Step 1: Update the test route tab**

In `tests/unit/LeagueTabs.teamIdentity.test.tsx`, change the mocked search param from:

```ts
get: (key: string) => (key === 'tab' ? 'settings' : null),
```

to:

```ts
get: (key: string) => (key === 'tab' ? 'team-settings' : null),
```

- [ ] **Step 2: Add a team settings save test**

Add this test:

```ts
it('saves team name and league notification preferences for an ordinary member', async () => {
  mockLeagueFetches();

  render(<LeagueTabs league={league} members={members} currentUserId="member-user" />);

  expect(await screen.findByText('Team Settings')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Team name'), {
    target: { value: 'New Member Team' },
  });
  fireEvent.click(screen.getByLabelText('Trade offers'));
  fireEvent.click(screen.getByRole('button', { name: 'Save team settings' }));

  await waitFor(() => {
    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/api/leagues/league-1/members/me',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName: 'New Member Team',
          notificationSettings: {
            tradePush: false,
            waiverPush: true,
            draftReminder: true,
            scoringAlerts: true,
          },
        }),
      }),
      'member-user'
    );
  });
});
```

- [ ] **Step 3: Run the team settings test and verify it fails**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.teamIdentity.test.tsx
```

Expected: FAIL because team name and notification UI do not exist yet.

- [ ] **Step 4: Add TeamSettingsPanel state**

Inside `TeamSettingsPanel`, add:

```ts
const [teamName, setTeamName] = useState(currentMember?.teamName ?? '');
const [notificationSettings, setNotificationSettings] = useState(
  currentMember?.notificationSettings ?? {
    tradePush: true,
    waiverPush: true,
    draftReminder: true,
    scoringAlerts: true,
  }
);
const [teamSettingsMessage, setTeamSettingsMessage] = useState<LeagueSettingsMessage | null>(null);
const [isSavingTeamSettings, setIsSavingTeamSettings] = useState(false);
```

Add an effect to resync when `currentMember` changes.

- [ ] **Step 5: Add saveTeamSettings**

Inside `TeamSettingsPanel`, add:

```ts
const saveTeamSettings = async () => {
  if (!currentUserId || !currentMember) return;

  try {
    setIsSavingTeamSettings(true);
    setTeamSettingsMessage(null);
    const response = await authenticatedFetch(
      `/api/leagues/${league.id}/members/me`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName,
          notificationSettings,
        }),
      },
      currentUserId
    );
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? `status ${response.status}`);
    }

    const nextMember =
      isRecord(payload.data) && isRecord(payload.data.member)
        ? ({ ...currentMember, ...payload.data.member } as LeagueMember)
        : { ...currentMember, teamName, notificationSettings };

    onMemberChange?.(nextMember);
    setTeamSettingsMessage({ type: 'success', text: 'Team settings saved.' });
  } catch (error) {
    setTeamSettingsMessage({
      type: 'error',
      text: error instanceof Error ? error.message : 'Failed to save team settings.',
    });
  } finally {
    setIsSavingTeamSettings(false);
  }
};
```

- [ ] **Step 6: Render team details and notifications**

Above the team identity section, render:

```tsx
<section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
  <h3 className="text-base font-semibold text-[color:var(--league-text)]">Team details</h3>
  <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
    Team name
    <input
      type="text"
      value={teamName}
      onChange={(event) => setTeamName(event.target.value)}
      className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
    />
  </label>
</section>
```

Below team identity, render notification checkboxes and a `Save team settings` button. Each checkbox must use a visible label and update the matching boolean key.

- [ ] **Step 7: Run focused team settings tests**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit UI split**

Run:

```bash
git add src/components/league/LeagueTabs.tsx tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts
git commit -m "Split team and league settings tabs"
```

## Task 4: Full Verification And Browser Smoke

**Files:**
- Verify only.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm run test:unit -- tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts tests/unit/leagueMemberIdentityRouteArchitecture.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run targeted lint**

Run:

```bash
npx eslint src/components/league/LeagueTabs.tsx 'src/app/api/leagues/[id]/members/me/route.ts' src/types/leagues.ts tests/unit/LeagueTabs.teamIdentity.test.tsx tests/unit/leagueSettingsUiArchitecture.test.ts tests/unit/leagueMemberIdentityRouteArchitecture.test.ts
```

Expected: exit code 0.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Browser smoke**

With the dev server running, verify:

```text
http://localhost:3000/leagues/cmni37suz001gux0nlx0506es?tab=team-settings
```

Expected:

- `Team Settings` tab selected.
- `Team details`, `Team identity`, and `Notifications` sections visible.
- Team identity image controls are not visible on `League Settings`.

Then verify:

```text
http://localhost:3000/leagues/cmni37suz001gux0nlx0506es?tab=league-settings
```

Expected:

- Commissioner sees league-level settings.
- Page contains `League Settings`.
- Page does not contain `Team identity`.

- [ ] **Step 6: Decision 2 and reviewed commit**

Run:

```bash
git status --short
npm run codex:council:logical -- --staged --prompt "Chairman Decision 2: decide whether the team settings split is ready to commit."
npm run codex:commit:reviewed -- "Split team and league settings"
```

Expected: council returns `CHAIRMAN DECISION 2: COMMIT`, then reviewed commit succeeds.

## Self-Review

- Spec coverage: navigation split, tab visibility, team name, identity, notification settings, route persistence, and verification are covered.
- Placeholder scan: no unfinished placeholder markers remain.
- Type consistency: `LeagueMemberNotificationSettings`, `notificationSettings`, `team-settings`, and `league-settings` are used consistently.
