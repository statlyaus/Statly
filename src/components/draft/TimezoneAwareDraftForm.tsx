'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import Alert from '@/components/ui/Alert';
import {
  COMMON_TIMEZONES,
  getBrowserTimeZone,
  getTimezoneInfo,
  findOptimalMeetingTime,
  formatInTimezone,
} from '@/lib/timezone';
import { TIME_PER_PICK_OPTIONS } from '@/lib/draftSettings';

interface DraftFormData {
  name: string;
  leagueSize: number;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  scheduledTime: string;
  timeZone: string;
  enableReminders: boolean;
}

interface TimezoneAwareDraftFormProps {
  onSubmit: (data: DraftFormData) => Promise<void>;
  isLoading?: boolean;
  participantTimezones?: string[]; // For optimal time suggestions
}

export default function TimezoneAwareDraftForm({
  onSubmit,
  isLoading = false,
  participantTimezones = [],
}: TimezoneAwareDraftFormProps) {
  const [formData, setFormData] = useState<DraftFormData>({
    name: '',
    leagueSize: 12,
    draftType: 'snake',
    timePerPick: 120,
    scheduledTime: '',
    timeZone: 'UTC',
    enableReminders: true,
  });

  const [showOptimalTimes, setShowOptimalTimes] = useState(false);
  const [optimalTimes, setOptimalTimes] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Initialize with browser timezone
  useEffect(() => {
    const browserTZ = getBrowserTimeZone();
    setFormData((prev) => ({ ...prev, timeZone: browserTZ }));
  }, []);

  // Calculate optimal meeting times when participant timezones are available
  useEffect(() => {
    if (participantTimezones.length > 1) {
      const suggestions = findOptimalMeetingTime(participantTimezones);
      setOptimalTimes(suggestions.slice(0, 5)); // Top 5 suggestions
    }
  }, [participantTimezones]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!formData.name.trim()) {
      setError('Draft name is required');
      return;
    }

    if (formData.scheduledTime && new Date(formData.scheduledTime) <= new Date()) {
      setError('Scheduled time must be in the future');
      return;
    }

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create draft');
    }
  };

  const handleOptimalTimeSelect = (time: Date) => {
    const localDateTime = format(time, "yyyy-MM-dd'T'HH:mm");
    setFormData((prev) => ({ ...prev, scheduledTime: localDateTime }));
    setShowOptimalTimes(false);
  };

  const currentTimezoneInfo = getTimezoneInfo(formData.timeZone);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <Alert type="error">{error}</Alert>}

      <FormField label="Draft Name *">
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter draft name"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </FormField>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="League Size *">
          <select
            value={formData.leagueSize}
            onChange={(e) => setFormData({ ...formData, leagueSize: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[4, 6, 8, 10, 12, 14, 16, 18, 20].map((size) => (
              <option key={size} value={size}>
                {size} teams
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Draft Type *">
          <select
            value={formData.draftType}
            onChange={(e) =>
              setFormData({ ...formData, draftType: e.target.value as 'snake' | 'linear' })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="snake">Snake Draft</option>
            <option value="linear">Linear Draft</option>
          </select>
        </FormField>
      </div>

      <FormField label="Time Zone *">
        <select
          value={formData.timeZone}
          onChange={(e) => setFormData({ ...formData, timeZone: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
        <div className="mt-1 text-xs text-gray-500">
          Current time: {currentTimezoneInfo.currentTime} ({currentTimezoneInfo.name})
        </div>
      </FormField>

      <FormField label="Scheduled Start Time (Optional)">
        <input
          type="datetime-local"
          value={formData.scheduledTime}
          onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value })}
          min={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="mt-1 text-xs text-gray-500">
          Leave empty to start lobby immediately with draft beginning in 5 minutes. Time will be
          converted to {currentTimezoneInfo.name}.
        </div>

        {optimalTimes.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowOptimalTimes(!showOptimalTimes)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {showOptimalTimes ? 'Hide' : 'Show'} optimal times for all participants
            </button>

            {showOptimalTimes && (
              <div className="mt-2 p-3 bg-blue-50 rounded-md">
                <div className="text-sm font-medium text-blue-900 mb-2">
                  Suggested times (based on participant timezones):
                </div>
                <div className="space-y-2">
                  {optimalTimes.map((suggestion, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="text-sm">
                        <div className="font-medium">
                          {formatInTimezone(suggestion.time, formData.timeZone, 'PPP p')}
                        </div>
                        <div className="text-xs text-gray-600">
                          {suggestion.scores
                            .map(
                              (score: any) => `${score.timeZone.split('/')[1]}: ${score.localTime}`
                            )
                            .join(' • ')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOptimalTimeSelect(suggestion.time)}
                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                      >
                        Use This Time
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </FormField>

      <FormField label="Time Per Pick *">
        <select
          value={formData.timePerPick}
          onChange={(e) => setFormData({ ...formData, timePerPick: parseInt(e.target.value) })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {TIME_PER_PICK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Notifications">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={formData.enableReminders}
            onChange={(e) => setFormData({ ...formData, enableReminders: e.target.checked })}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="ml-2 text-sm text-gray-700">
            Send email reminders (24h, 2h, 30m, 15m before draft)
          </span>
        </label>
      </FormField>

      <div className="flex gap-3 pt-4">
        <Button
          type="submit"
          disabled={isLoading}
          className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? 'Creating Draft...' : 'Create Draft'}
        </Button>
      </div>
    </form>
  );
}
