'use client';

import { useState } from 'react';

import { ClipboardList, Trophy, Users } from 'lucide-react';

import { useAuth } from '@/AuthContext';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { UIInput, UISelect } from '@/components/ui';
import { fetchApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  leagueStatusTonePatterns,
  leagueSurfacePatterns,
} from '@/styles/leagueDesignSystem';

import { LeagueOnboardingShell } from '../_components/LeagueOnboardingShell';
import { LeagueSetupChecklist } from '../_components/LeagueSetupChecklist';

const setupHighlights = [
  {
    title: 'Competition identity',
    value: 'Name and format',
    icon: Trophy,
  },
  {
    title: 'Manager capacity',
    value: '8 to 18 teams',
    icon: Users,
  },
  {
    title: 'Commissioner next step',
    value: 'Draft hub',
    icon: ClipboardList,
  },
];

const createSteps = [
  {
    title: 'Choose your league basics',
    description: 'Set the league name, manager count, and scoring format.',
  },
  {
    title: 'Invite managers',
    description: 'Bring your competition into the league once the basics are saved.',
  },
  {
    title: 'Open draft setup',
    description: 'Move straight into the draft hub after the league is created.',
  },
];

const createSummary = [
  { label: 'Recommended size', value: '10-14 teams' },
  { label: 'Default format', value: 'Standard' },
  { label: 'Next screen', value: 'Draft setup' },
];

interface CreatedLeague {
  id: string;
  name: string;
  code?: string;
}

export default function NewLeagueClient() {
  const [leagueName, setLeagueName] = useState('');
  const [teamCount, setTeamCount] = useState(12);
  const [scoringFormat, setScoringFormat] = useState('standard');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdLeague, setCreatedLeague] = useState<CreatedLeague | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const { user } = useAuth();

  const inviteUrl =
    createdLeague?.code && typeof window !== 'undefined'
      ? `${window.location.origin}/leagues/join?code=${createdLeague.code}`
      : null;

  const copyInviteLink = async () => {
    if (!inviteUrl || !window.navigator.clipboard) return;

    await window.navigator.clipboard.writeText(inviteUrl);
    setCopiedInvite(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) {
      setError('You must be logged in to create a league.');
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchApi('leagues', {
        method: 'POST',
        body: JSON.stringify({
          name: leagueName,
          teamCount,
          scoringFormat,
          commissionerId: user.uid,
        }),
      });
      const created = (response as { data?: { id?: string; name?: string; code?: string } })
        ?.data;
      if (!created?.id) {
        throw new Error('League created but no league ID was returned');
      }
      setCreatedLeague({
        id: created.id,
        name: created.name || leagueName,
        code: created.code,
      });
    } catch (err) {
      setError('Failed to create league. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (createdLeague) {
    return (
      <LeagueOnboardingShell
        eyebrow="League setup"
        title={`${createdLeague.name} is ready for setup`}
        description="Your league has been created. Finish the commissioner steps in the order managers will experience them: invite, confirm settings, then open draft setup."
        primaryAction={{ href: `/leagues/${createdLeague.id}?tab=draft`, label: 'Draft setup', active: true }}
        secondaryAction={{ href: `/leagues/${createdLeague.id}`, label: 'League workspace' }}
        steps={createSteps}
        summary={[
          { label: 'League', value: createdLeague.name },
          { label: 'Invite code', value: createdLeague.code || 'Create in settings' },
          { label: 'Next screen', value: 'Draft setup' },
        ]}
      >
        <div className="space-y-6">
          <div>
            <p className={leagueSurfacePatterns.sectionEyebrow}>Commissioner handoff</p>
            <h2 className="mt-3 text-2xl font-semibold text-[color:var(--league-text)]">
              Finish the steps managers will depend on
            </h2>
            <p className={cn(leagueSurfacePatterns.body, 'mt-3 max-w-2xl')}>
              This keeps setup visible instead of dropping you into a blank workspace.
              You can return here from league settings if the draft is not ready.
            </p>
          </div>

          <LeagueSetupChecklist
            title="Commissioner setup path"
            description="Use this checklist to move from league creation to a draft-ready competition."
            steps={[
              {
                id: 'basics',
                title: 'League basics saved',
                detail: `${teamCount} teams using ${scoringFormat} scoring.`,
                complete: true,
                action: {
                  label: 'Review settings',
                  href: `/leagues/${createdLeague.id}?tab=settings`,
                },
              },
              {
                id: 'invites',
                title: 'Invite managers',
                detail: createdLeague.code
                  ? copiedInvite
                    ? 'Invite link copied. Share it with managers before draft night.'
                    : 'Copy the invite link or open settings to send manager invites.'
                  : 'Open settings to generate and manage manager invites.',
                complete: copiedInvite,
                action:
                  inviteUrl && !copiedInvite
                    ? { label: 'Copy invite link', onClick: () => void copyInviteLink() }
                    : {
                        label: 'Open settings',
                        href: `/leagues/${createdLeague.id}?tab=settings`,
                      },
              },
              {
                id: 'draft',
                title: 'Set draft order and time',
                detail: 'Open draft setup once managers have joined and settings are confirmed.',
                complete: false,
                action: {
                  label: 'Open draft setup',
                  href: `/leagues/${createdLeague.id}?tab=draft`,
                },
              },
            ]}
          />
        </div>
      </LeagueOnboardingShell>
    );
  }

  return (
    <LeagueOnboardingShell
      eyebrow="League setup"
      title="Create a league built for draft night"
      description="Name the competition, choose the manager count, confirm scoring, then move straight into draft setup."
      primaryAction={{ href: '/leagues/new', label: 'Create league', active: true }}
      secondaryAction={{ href: '/leagues/join', label: 'Join league' }}
      steps={createSteps}
      summary={createSummary}
    >
      <div className="space-y-6">
        <div>
          <p className={leagueSurfacePatterns.sectionEyebrow}>Commissioner setup</p>
          <h2 className="mt-3 text-2xl font-semibold text-[color:var(--league-text)]">
            Confirm the league basics
          </h2>
          <p className={cn(leagueSurfacePatterns.body, 'mt-3 max-w-2xl')}>
            Detailed roster, waiver, and draft settings can be adjusted after creation.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {setupHighlights.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.title} className={leagueSurfacePatterns.subpanel}>
                <Icon
                  aria-hidden="true"
                  className="size-5 text-[color:var(--league-accent)]"
                />
                <h3 className="mt-3 text-sm font-semibold text-[color:var(--league-text)]">
                  {item.title}
                </h3>
                <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                  {item.value}
                </p>
              </div>
            );
          })}
        </div>

        <form aria-label="Create league form" onSubmit={handleSubmit} className="space-y-6">
          <FormField
            label="League Name"
            required
            helpText="Use a name your managers will recognise in invites and league switchers."
          >
            <UIInput
              id="leagueName"
              type="text"
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
              disabled={isLoading}
              required
              placeholder="e.g. Friday Night Captains"
            />
          </FormField>

          <div className="grid gap-5 md:grid-cols-2">
            <FormField
              label="Number of Teams"
              helpText="Pick the manager count you expect before invites go out."
            >
              <UISelect
                id="teamCount"
                value={String(teamCount)}
                onChange={(e) => setTeamCount(Number(e.target.value))}
                disabled={isLoading}
              >
                {[8, 10, 12, 14, 16, 18].map((count) => (
                  <option key={count} value={String(count)}>
                    {count} Teams
                  </option>
                ))}
              </UISelect>
            </FormField>

            <FormField
              label="Scoring Format"
              helpText="Start with the format your league will draft against."
            >
              <UISelect
                id="scoringFormat"
                value={scoringFormat}
                onChange={(e) => setScoringFormat(e.target.value)}
                disabled={isLoading}
              >
                <option value="standard">Standard</option>
                <option value="ppr">Points Per Reception (PPR)</option>
                <option value="nine-category">9-Category Head-to-Head</option>
              </UISelect>
            </FormField>
          </div>

          {error && (
            <p
              className={cn(leagueStatusTonePatterns.danger, 'rounded-2xl px-4 py-3 text-sm')}
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3 border-t border-[color:var(--league-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[color:var(--league-text-muted)]">
              You can invite managers after the league is created.
            </p>
            <Button
              type="submit"
              disabled={isLoading}
              loading={isLoading}
              loadingText="Creating..."
            >
              Create league
            </Button>
          </div>
        </form>
      </div>
    </LeagueOnboardingShell>
  );
}
