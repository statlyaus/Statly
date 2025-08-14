'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { AppLayout } from '@/components/navigation';

interface CreateDraftForm {
  name: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  scheduledTime?: string;
}

export default function CreateDraftPage() {
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
        <p className="text-gray-600 mt-2">
          Set up a new fantasy AFL draft for your league.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <FormField label="Draft Name *">
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., 2025 AFL Fantasy League"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </FormField>

        <FormField label="League Size *">
          <select
            value={formData.leagueSize}
            onChange={(e) => setFormData({ ...formData, leagueSize: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[8, 10, 12, 14, 16, 18, 20].map(size => (
              <option key={size} value={size}>{size} teams</option>
            ))}
          </select>
        </FormField>

        <FormField label="Draft Type *">
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                value="snake"
                checked={formData.draftType === 'snake'}
                onChange={(e) => setFormData({ ...formData, draftType: e.target.value as 'snake' | 'linear' })}
                className="mr-2"
              />
              Snake Draft (Round 1: 1→12, Round 2: 12→1, etc.)
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="linear"
                checked={formData.draftType === 'linear'}
                onChange={(e) => setFormData({ ...formData, draftType: e.target.value as 'snake' | 'linear' })}
                className="mr-2"
              />
              Linear Draft (Every round: 1→12)
            </label>
          </div>
        </FormField>

        <FormField label="Time Per Pick (seconds) *">
          <select
            value={formData.timePerPick}
            onChange={(e) => setFormData({ ...formData, timePerPick: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={60}>1 minute</option>
            <option value={90}>1.5 minutes</option>
            <option value={120}>2 minutes</option>
            <option value={180}>3 minutes</option>
            <option value={300}>5 minutes</option>
          </select>
        </FormField>

        <FormField label="Scheduled Start Time (Optional)">
          <input
            type="datetime-local"
            value={formData.scheduledTime || ''}
            onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-sm text-gray-500 mt-1">
            Leave empty to start the draft immediately
          </p>
        </FormField>

        <div className="flex gap-4 pt-4">
          <Button 
            type="submit" 
            disabled={isLoading || !formData.name.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Creating...' : 'Create Draft'}
          </Button>
          <Button
            type="button"
            onClick={() => router.push('/drafts')}
            className="bg-gray-600 text-white px-6 py-2 rounded-md hover:bg-gray-700"
          >
            Cancel
          </Button>
        </div>
      </form>
    </main>
    </AppLayout>
  );
}
