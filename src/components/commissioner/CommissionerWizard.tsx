'use client';

import React, { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api';

interface LeagueSettings {
  scoring?: Record<string, number>;
  roster?: Record<string, number>;
  draft?: Record<string, unknown>;
  waivers?: Record<string, unknown>;
}

interface JoinStatus {
  joined: number;
  total: number;
}

interface CommissionerWizardProps {
  leagueId: string;
  settings: LeagueSettings | null;
}

const steps = ['Scoring', 'Roster', 'Draft', 'Waivers'] as const;

type Step = typeof steps[number];

export default function CommissionerWizard({ leagueId, settings }: CommissionerWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [joinStatus, setJoinStatus] = useState<JoinStatus | null>(null);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const data = await fetchApi(`leagues/${leagueId}/join-status`);
        setJoinStatus(data);
      } catch (err) {
        console.error('Failed to fetch join status', err);
      }
    };
    loadStatus();
  }, [leagueId]);

  const next = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const prev = () => setStepIndex((i) => Math.max(i - 1, 0));

  const currentStep = steps[stepIndex];

  const renderStep = (step: Step) => {
    switch (step) {
      case 'Scoring':
        return <pre className="text-sm bg-gray-50 p-4 rounded">{JSON.stringify(settings?.scoring, null, 2)}</pre>;
      case 'Roster':
        return <pre className="text-sm bg-gray-50 p-4 rounded">{JSON.stringify(settings?.roster, null, 2)}</pre>;
      case 'Draft':
        return <pre className="text-sm bg-gray-50 p-4 rounded">{JSON.stringify(settings?.draft, null, 2)}</pre>;
      case 'Waivers':
        return <pre className="text-sm bg-gray-50 p-4 rounded">{JSON.stringify(settings?.waivers, null, 2)}</pre>;
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-4">
      {joinStatus && (
        <div className="text-sm text-gray-600">
          Teams joined: {joinStatus.joined} / {joinStatus.total}
        </div>
      )}
      <div className="font-semibold text-lg">{currentStep} Settings</div>
      {renderStep(currentStep)}
      <div className="flex justify-between pt-4">
        <button
          onClick={prev}
          disabled={stepIndex === 0}
          className="px-4 py-2 rounded bg-gray-200 disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={next}
          disabled={stepIndex === steps.length - 1}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

