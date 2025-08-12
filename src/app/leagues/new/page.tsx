'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Form from '@/components/Form';
import FormField from '@/components/FormField';
import Button from '@/components/Button';
import { fetchFromAPI } from '@/lib/api';

export default function NewLeaguePage() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const league = await fetchFromAPI<{ id: string }>(
        '/api/leagues',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );
      router.push(`/leagues/${league.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create league';
      setError(message);
    }
  };

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-4 text-2xl font-semibold">Create League</h1>
      <Form onSubmit={handleSubmit}>
        <FormField label="League Name">
          <input
            className="w-full rounded border px-2 py-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </FormField>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit">Create</Button>
      </Form>
    </main>
  );
}
