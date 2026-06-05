'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  ListOrdered,
  Loader2,
} from 'lucide-react';

import { AppLayout } from '@/components/navigation';

interface CreateDraftForm {
  name: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  scheduledTime?: string;
}

const draftTypeOptions: Array<{
  value: CreateDraftForm['draftType'];
  title: string;
  description: string;
}> = [
  {
    value: 'snake',
    title: 'Snake draft',
    description: 'Pick order reverses after every round.',
  },
  {
    value: 'linear',
    title: 'Linear draft',
    description: 'Each round follows the same manager order.',
  },
];

export default function CreateDraftPage(): JSX.Element {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateDraftForm>({
    name: '',
    leagueSize: 12,
    draftType: 'snake',
    timePerPick: 120,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to create draft');
      }

      const { data: draft } = await response.json();
      router.push(`/drafts/${draft.id}`);
    } catch (error) {
      console.error('Error creating draft:', error);
      setError('Failed to create draft. Please check the settings and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppLayout>
      <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] text-[color:var(--league-text)]">
        <div className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
          <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)] sm:p-6">
            <button
              type="button"
              onClick={() => router.push('/drafts')}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Draft center
            </button>

            <header className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                Room setup
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-4xl">
                Create new draft
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-base">
                Set the room rules now so managers land in a predictable draft experience when the
                clock starts.
              </p>
            </header>

            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <div>
                <label
                  htmlFor="draft-name"
                  className="text-sm font-semibold text-[color:var(--league-text)]"
                >
                  Draft name
                </label>
                <input
                  id="draft-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. 2026 Statly Premier Draft"
                  className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-medium text-[color:var(--league-text)] outline-none transition placeholder:text-[color:var(--league-text-muted)] focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="league-size"
                    className="text-sm font-semibold text-[color:var(--league-text)]"
                  >
                    League size
                  </label>
                  <select
                    id="league-size"
                    value={formData.leagueSize}
                    onChange={(e) =>
                      setFormData({ ...formData, leagueSize: parseInt(e.target.value) })
                    }
                    className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-semibold text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                  >
                    {[8, 10, 12, 14, 16, 18, 20].map((size) => (
                      <option key={size} value={size}>
                        {size} teams
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="time-per-pick"
                    className="text-sm font-semibold text-[color:var(--league-text)]"
                  >
                    Time per pick
                  </label>
                  <select
                    id="time-per-pick"
                    value={formData.timePerPick}
                    onChange={(e) =>
                      setFormData({ ...formData, timePerPick: parseInt(e.target.value) })
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
              </div>

              <fieldset>
                <legend className="text-sm font-semibold text-[color:var(--league-text)]">
                  Draft type
                </legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {draftTypeOptions.map((option) => (
                    <div
                      key={option.value}
                      className="flex gap-3 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-4 transition focus-within:ring-2 focus-within:ring-[color:var(--league-primary)] hover:bg-[color:var(--league-surface-muted)]"
                    >
                      <input
                        id={`draft-type-${option.value}`}
                        type="radio"
                        name="draftType"
                        value={option.value}
                        checked={formData.draftType === option.value}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            draftType: e.target.value as CreateDraftForm['draftType'],
                          })
                        }
                        className="mt-1 h-4 w-4 accent-[color:var(--league-primary)]"
                      />
                      <span>
                        <label
                          htmlFor={`draft-type-${option.value}`}
                          className="block cursor-pointer text-sm font-semibold text-[color:var(--league-text)]"
                        >
                          {option.title}
                        </label>
                        <span className="mt-1 block text-sm leading-5 text-[color:var(--league-text-muted)]">
                          {option.description}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </fieldset>

              <div>
                <label
                  htmlFor="scheduled-time"
                  className="text-sm font-semibold text-[color:var(--league-text)]"
                >
                  Scheduled start time
                </label>
                <input
                  id="scheduled-time"
                  type="datetime-local"
                  value={formData.scheduledTime || ''}
                  onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value })}
                  className="mt-2 h-11 w-full rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-medium text-[color:var(--league-text)] outline-none transition focus:border-[color:var(--league-primary)] focus:ring-2 focus:ring-[color:var(--league-primary)]/20"
                />
                <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
                  Leave empty to start the draft immediately.
                </p>
              </div>

              {error && (
                <div className="rounded-2xl border border-[color:var(--league-danger)]/30 bg-[color:var(--league-danger-soft)] px-4 py-3 text-sm font-medium text-[color:var(--league-danger)]">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-[color:var(--league-border)] pt-5 sm:flex-row">
                <button
                  type="submit"
                  disabled={isLoading || !formData.name.trim()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {isLoading ? 'Creating draft' : 'Create draft'}
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/drafts')}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-5 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {[
              {
                icon: ListOrdered,
                label: 'Draft order',
                value: formData.draftType === 'snake' ? 'Snake' : 'Linear',
              },
              { icon: Clock3, label: 'Pick clock', value: `${formData.timePerPick}s` },
              {
                icon: CalendarClock,
                label: 'Start',
                value: formData.scheduledTime ? 'Scheduled' : 'Immediate',
              },
            ].map((item) => {
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
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-[color:var(--league-text)]">
                Setup checklist
              </h2>
              <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
                Confirm league size, draft type, and pick clock before inviting managers into the
                room.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </AppLayout>
  );
}
