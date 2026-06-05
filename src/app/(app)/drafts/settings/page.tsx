'use client';

import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Loader2,
  RotateCcw,
  Save,
  Volume2,
  Zap,
} from 'lucide-react';

import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import { AppLayout } from '@/components/navigation';

interface DraftPreferences {
  autoPickEnabled: boolean;
  autoPickTime: number;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  defaultTimePerPick: number;
  preferredDraftType: 'SNAKE' | 'LINEAR';
  timezone: string;
}

const defaultPreferences: DraftPreferences = {
  autoPickEnabled: false,
  autoPickTime: 120,
  notificationsEnabled: true,
  soundEnabled: true,
  defaultTimePerPick: 120,
  preferredDraftType: 'SNAKE',
  timezone: 'Australia/Melbourne',
};

function ToggleField({
  id,
  checked,
  title,
  description,
  icon: Icon,
  onChange,
}: {
  id: string;
  checked: boolean;
  title: string;
  description: string;
  icon: typeof Bell;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-4">
      <div className="flex min-w-0 gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <label htmlFor={id} className="text-sm font-semibold text-[color:var(--league-text)]">
            {title}
          </label>
          <p className="mt-1 text-sm leading-5 text-[color:var(--league-text-muted)]">
            {description}
          </p>
        </div>
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 rounded border-[color:var(--league-border)] accent-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/30"
      />
    </div>
  );
}

export default function DraftSettingsPage(): JSX.Element {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<DraftPreferences>(defaultPreferences);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      if (!user) return;

      try {
        setIsLoading(true);
        const response = await fetchApi('user/draft-settings');

        if (response.success) {
          setPreferences(response.data);
        }
      } catch (err) {
        console.error('Error loading draft settings:', err);
      } finally {
        setIsLoading(false);
      }
    };

    const detectTimezone = () => {
      try {
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (userTimezone) {
          setPreferences((prev) => ({ ...prev, timezone: userTimezone }));
        }
      } catch (_err) {
        console.warn('Could not detect timezone, using UTC fallback');
        setPreferences((prev) => ({ ...prev, timezone: 'UTC' }));
      }
    };

    void loadSettings();
    detectTimezone();
  }, [user]);

  const summaryItems = useMemo(
    () => [
      {
        icon: Zap,
        label: 'Auto-pick',
        value: preferences.autoPickEnabled ? `${preferences.autoPickTime}s` : 'Off',
      },
      {
        icon: Bell,
        label: 'Notifications',
        value: preferences.notificationsEnabled ? 'On' : 'Off',
      },
      { icon: Clock3, label: 'Default clock', value: `${preferences.defaultTimePerPick}s` },
      { icon: Volume2, label: 'Sound', value: preferences.soundEnabled ? 'On' : 'Off' },
    ],
    [preferences]
  );

  const handleSave = async () => {
    if (!user) return;

    try {
      setIsSaving(true);
      setMessage(null);

      const response = await fetchApi('user/draft-settings', {
        method: 'PUT',
        body: JSON.stringify(preferences),
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.success) {
        setMessage({ type: 'success', text: 'Draft settings saved.' });
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to save settings.' });
      }
    } catch (_err) {
      console.error('Failed to save draft settings:', _err);
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setPreferences(defaultPreferences);
    setMessage(null);
  };

  if (!user) {
    return (
      <AppLayout>
        <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] px-4 py-10 text-[color:var(--league-text)]">
          <section className="mx-auto max-w-md rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-6 text-center shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
              <Clock3 className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
              Sign in to manage draft timers, notifications, sound, and auto-pick preferences.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          </section>
        </main>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] text-[color:var(--league-text)]">
        <div className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
          <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)] sm:p-6">
            <Link
              href="/drafts"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Draft center
            </Link>

            <header className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                Preferences
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-4xl">
                Draft settings
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-base">
                Set the default draft experience for timers, auto-pick behavior, notifications, and
                room preferences.
              </p>
            </header>

            {isLoading ? (
              <div className="mt-8 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-8 text-center">
                <Loader2
                  className="mx-auto h-8 w-8 animate-spin text-[color:var(--league-primary)]"
                  aria-hidden="true"
                />
                <p className="mt-4 text-sm font-semibold text-[color:var(--league-text)]">
                  Loading settings
                </p>
              </div>
            ) : (
              <div className="mt-8 space-y-6">
                <section>
                  <h2 className="text-base font-semibold text-[color:var(--league-text)]">
                    Auto-pick
                  </h2>
                  <div className="mt-3 space-y-3">
                    <ToggleField
                      id="auto-pick-enabled"
                      checked={preferences.autoPickEnabled}
                      title="Enable auto-pick"
                      description="Automatically select a player when your clock expires."
                      icon={Zap}
                      onChange={(checked) =>
                        setPreferences((prev) => ({ ...prev, autoPickEnabled: checked }))
                      }
                    />

                    {preferences.autoPickEnabled && (
                      <div>
                        <label
                          htmlFor="auto-pick-time"
                          className="text-sm font-semibold text-[color:var(--league-text)]"
                        >
                          Auto-pick time
                        </label>
                        <select
                          id="auto-pick-time"
                          value={preferences.autoPickTime}
                          onChange={(e) =>
                            setPreferences((prev) => ({
                              ...prev,
                              autoPickTime: parseInt(e.target.value),
                            }))
                          }
                          className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                        >
                          <option value={30}>30 seconds</option>
                          <option value={60}>1 minute</option>
                          <option value={90}>1.5 minutes</option>
                          <option value={120}>2 minutes</option>
                          <option value={180}>3 minutes</option>
                        </select>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <h2 className="text-base font-semibold text-[color:var(--league-text)]">
                    Alerts
                  </h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <ToggleField
                      id="notifications-enabled"
                      checked={preferences.notificationsEnabled}
                      title="Notifications"
                      description="Receive browser alerts during live draft rooms."
                      icon={Bell}
                      onChange={(checked) =>
                        setPreferences((prev) => ({ ...prev, notificationsEnabled: checked }))
                      }
                    />
                    <ToggleField
                      id="sound-enabled"
                      checked={preferences.soundEnabled}
                      title="Sound"
                      description="Play sounds for pick and turn events."
                      icon={Volume2}
                      onChange={(checked) =>
                        setPreferences((prev) => ({ ...prev, soundEnabled: checked }))
                      }
                    />
                  </div>
                </section>

                <section>
                  <h2 className="text-base font-semibold text-[color:var(--league-text)]">
                    Defaults
                  </h2>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="default-time-per-pick"
                        className="text-sm font-semibold text-[color:var(--league-text)]"
                      >
                        Default time per pick
                      </label>
                      <select
                        id="default-time-per-pick"
                        value={preferences.defaultTimePerPick}
                        onChange={(e) =>
                          setPreferences((prev) => ({
                            ...prev,
                            defaultTimePerPick: parseInt(e.target.value),
                          }))
                        }
                        className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                      >
                        <option value={60}>1 minute</option>
                        <option value={90}>1.5 minutes</option>
                        <option value={120}>2 minutes</option>
                        <option value={180}>3 minutes</option>
                        <option value={300}>5 minutes</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="preferred-draft-type"
                        className="text-sm font-semibold text-[color:var(--league-text)]"
                      >
                        Preferred draft type
                      </label>
                      <select
                        id="preferred-draft-type"
                        value={preferences.preferredDraftType}
                        onChange={(e) =>
                          setPreferences((prev) => ({
                            ...prev,
                            preferredDraftType: e.target.value as 'SNAKE' | 'LINEAR',
                          }))
                        }
                        className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                      >
                        <option value="SNAKE">Snake draft</option>
                        <option value="LINEAR">Linear draft</option>
                      </select>
                    </div>
                  </div>
                </section>

                {message && (
                  <div
                    className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                      message.type === 'success'
                        ? 'border-[color:var(--league-success)]/30 bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]'
                        : 'border-[color:var(--league-danger)]/30 bg-[color:var(--league-danger-soft)] text-[color:var(--league-danger)]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {message.type === 'success' ? (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      )}
                      {message.text}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-[color:var(--league-border)] pt-5 sm:flex-row sm:justify-between">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-5 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Reset defaults
                  </button>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => window.history.back()}
                      className="inline-flex h-11 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-5 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Save className="h-4 w-4" aria-hidden="true" />
                      )}
                      {isSaving ? 'Saving' : 'Save settings'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {summaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 shadow-[0_18px_55px_-44px_rgba(23,34,48,0.35)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--league-text-muted)]">
                        {item.label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[color:var(--league-text)]">
                        {item.value}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--league-text-muted)]">
                Timezone
              </p>
              <p className="mt-2 text-sm font-semibold text-[color:var(--league-text)]">
                {preferences.timezone}
              </p>
            </div>
          </aside>
        </div>
      </main>
    </AppLayout>
  );
}
