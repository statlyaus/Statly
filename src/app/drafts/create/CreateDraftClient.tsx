'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { AppLayout } from '@/components/navigation';
import { UIInput, UISelect } from '@/components/ui';

interface CreateDraftForm {
  name: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  scheduledTime?: string;
}

export default function CreateDraftClient() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<CreateDraftForm>({
    name: '',
    leagueSize: 12,
    draftType: 'snake',
    timePerPick: 120,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!response.ok) throw new Error('Failed to create draft');
      const { data: draft } = await response.json();
      router.push(`/drafts/${draft.id}`);
    } catch (error) {
      console.error('Error creating draft:', error);
      alert('Failed to create draft. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppLayout>
      <main className="mx-auto max-w-2xl p-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Create New Draft</h1>
          <p className="text-gray-600 mt-2">Set up a new fantasy AFL draft for your league.</p>
        </header>
        <form onSubmit={handleSubmit} className="space-y-6">
          <FormField label="Draft Name" required>
            <UIInput
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., 2025 AFL Fantasy League"
              required
            />
          </FormField>
          <FormField label="League Size" required>
            <UISelect
              value={formData.leagueSize}
              onChange={(e) => setFormData({ ...formData, leagueSize: parseInt(e.target.value) })}
            >
              {[8, 10, 12, 14, 16, 18, 20].map((size) => (
                <option key={size} value={size}>
                  {size} teams
                </option>
              ))}
            </UISelect>
          </FormField>
          <FormField label="Draft Type" required>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  value="snake"
                  checked={formData.draftType === 'snake'}
                  onChange={(e) =>
                    setFormData({ ...formData, draftType: e.target.value as 'snake' | 'linear' })
                  }
                  className="h-4 w-4 border-input text-primary focus:ring-ring"
                />
                Snake Draft (Round 1: 1→12, Round 2: 12→1, etc.)
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  value="linear"
                  checked={formData.draftType === 'linear'}
                  onChange={(e) =>
                    setFormData({ ...formData, draftType: e.target.value as 'snake' | 'linear' })
                  }
                  className="h-4 w-4 border-input text-primary focus:ring-ring"
                />
                Linear Draft (Every round: 1→12)
              </label>
            </div>
          </FormField>
          <FormField label="Time Per Pick (seconds)" required>
            <UISelect
              value={formData.timePerPick}
              onChange={(e) => setFormData({ ...formData, timePerPick: parseInt(e.target.value) })}
            >
              <option value={60}>1 minute</option>
              <option value={90}>1.5 minutes</option>
              <option value={120}>2 minutes</option>
              <option value={180}>3 minutes</option>
              <option value={300}>5 minutes</option>
            </UISelect>
          </FormField>
          <FormField
            label="Scheduled Start Time (Optional)"
            helpText="Leave empty to start the draft immediately"
          >
            <UIInput
              type="datetime-local"
              value={formData.scheduledTime || ''}
              onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value })}
            />
          </FormField>
          <div className="flex gap-4 pt-4">
            <Button type="submit" disabled={isLoading || !formData.name.trim()} loading={isLoading}>
              {isLoading ? 'Creating...' : 'Create Draft'}
            </Button>
            <Button type="button" onClick={() => router.push('/drafts')} variant="secondary">
              Cancel
            </Button>
          </div>
        </form>
      </main>
    </AppLayout>
  );
}
