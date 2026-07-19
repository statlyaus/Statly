'use client';

import { useId, useState } from 'react';

import type { SocialNotificationPreferences } from '@/types/social';

const preferenceLabels: Array<{
  key: keyof SocialNotificationPreferences;
  label: string;
  description: string;
}> = [
  {
    key: 'chatInApp',
    label: 'League chat',
    description: 'Show in-app activity for new chat messages.',
  },
  {
    key: 'boardPosts',
    label: 'All message-board posts',
    description: 'Notify me when any new discussion is created.',
  },
  {
    key: 'ownPostReplies',
    label: 'Replies to my posts',
    description: 'Notify me when someone replies to my discussion.',
  },
  {
    key: 'announcements',
    label: 'Commissioner announcements',
    description: 'Notify me about official league announcements.',
  },
  {
    key: 'tradeDiscussions',
    label: 'Trade discussions',
    description: 'Notify me about activity in the Trades category.',
  },
  {
    key: 'mentions',
    label: 'Mentions',
    description: 'Notify me when another member mentions me.',
  },
  {
    key: 'systemActivityInApp',
    label: 'League activity',
    description: 'Show draft, transaction, and scoring events in chat.',
  },
];

export default function SocialPreferencesPanel({
  preferences,
  onSave,
  onClose,
}: {
  preferences: SocialNotificationPreferences;
  onSave: (preferences: SocialNotificationPreferences) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(preferences);
  const fieldPrefix = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="social-preferences-heading"
      className="border-b border-border bg-background p-4"
    >
      <h2 id="social-preferences-heading" className="text-base font-semibold text-foreground">
        Social notifications
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose which league conversations contribute to your notifications.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {preferenceLabels.map((preference) => (
          <div
            key={preference.key}
            className="flex min-h-16 items-start gap-3 rounded-xl border border-border bg-card p-3"
          >
            <input
              id={`${fieldPrefix}-${preference.key}`}
              type="checkbox"
              aria-label={preference.label}
              checked={draft[preference.key]}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [preference.key]: event.target.checked,
                }))
              }
              className="mt-1 size-4 rounded border-border text-primary focus:ring-ring"
            />
            <span>
              <span className="block text-sm font-semibold text-foreground">
                {preference.label}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {preference.description}
              </span>
            </span>
          </div>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
