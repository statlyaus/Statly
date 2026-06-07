'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { Alert, useConfirmation } from '@/components/ui';
import {
  COMMON_TIMEZONES,
  getBrowserTimeZone,
  utcToDatetimeLocal,
  formatInTimezone,
  getTimezoneInfo,
} from '@/lib/timezone';
import { TIME_PER_PICK_OPTIONS } from '@/lib/draftSettings';

interface DraftScheduleManagerProps {
  draftId: string;
  currentScheduledTime?: string;
  currentTimePerPick?: number;
  currentTimeZone?: string;
  status: 'scheduled' | 'live' | 'completed';
  onScheduleUpdated?: () => void;
}

export default function DraftScheduleManager({
  draftId,
  currentScheduledTime,
  currentTimePerPick = 120,
  currentTimeZone,
  status,
  onScheduleUpdated,
}: DraftScheduleManagerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userTimeZone, setUserTimeZone] = useState<string>('');
  const { confirm, ConfirmationModal } = useConfirmation();

  const [formData, setFormData] = useState({
    scheduledTime: '',
    timePerPick: currentTimePerPick,
    timeZone: currentTimeZone || 'UTC',
    enableReminders: true,
  });

  // Initialize timezone and convert scheduled time
  useEffect(() => {
    const browserTZ = getBrowserTimeZone();
    setUserTimeZone(browserTZ);

    if (currentScheduledTime) {
      const utcDate = new Date(currentScheduledTime);
      const localDateTime = utcToDatetimeLocal(utcDate, currentTimeZone || browserTZ);
      setFormData((prev) => ({
        ...prev,
        scheduledTime: localDateTime,
        timeZone: currentTimeZone || browserTZ,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        timeZone: browserTZ,
      }));
    }
  }, [currentScheduledTime, currentTimeZone]);

  const handleUpdateSchedule = async () => {
    if (!formData.scheduledTime) {
      setError('Scheduled time is required');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/drafts/${draftId}/schedule`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduledTime: formData.scheduledTime,
          timePerPick: formData.timePerPick,
          timeZone: formData.timeZone,
          enableReminders: formData.enableReminders,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update schedule');
      }

      setSuccess('Draft schedule updated successfully!');
      setIsEditing(false);
      onScheduleUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelSchedule = async () => {
    confirm({
      title: 'Start Draft Now',
      message: 'Cancel the schedule and start the draft immediately?',
      variant: 'warning',
      confirmText: 'Start Now',
      cancelText: 'Keep Schedule',
      onConfirm: async () => {
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
          const response = await fetch(`/api/drafts/${draftId}/schedule`, {
            method: 'DELETE',
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Failed to cancel schedule');
          }

          setSuccess('Draft schedule cancelled. Draft started immediately!');
          onScheduleUpdated?.();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to cancel schedule');
        } finally {
          setIsLoading(false);
        }
      },
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError(null);
    setSuccess(null);

    if (currentScheduledTime) {
      const utcDate = new Date(currentScheduledTime);
      const localDateTime = utcToDatetimeLocal(utcDate, formData.timeZone);
      setFormData({
        scheduledTime: localDateTime,
        timePerPick: currentTimePerPick,
        timeZone: currentTimeZone || userTimeZone,
        enableReminders: true,
      });
    } else {
      setFormData({
        scheduledTime: '',
        timePerPick: currentTimePerPick,
        timeZone: userTimeZone,
        enableReminders: true,
      });
    }
  };

  if (status === 'completed') {
    return (
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-lg font-medium text-gray-900 mb-2">Draft Schedule</h3>
        <p className="text-gray-600">This draft has been completed.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Draft Schedule</h3>
        {status === 'scheduled' && !isEditing && (
          <div className="flex gap-2">
            <Button
              onClick={() => setIsEditing(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              Edit Schedule
            </Button>
            <Button
              onClick={handleCancelSchedule}
              disabled={isLoading}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              Start Now
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Alert type="error" className="mb-4">
          {error}
        </Alert>
      )}

      {success && (
        <Alert type="success" className="mb-4">
          {success}
        </Alert>
      )}

      {!isEditing ? (
        <div className="space-y-3">
          <div>
            <span className="text-sm font-medium text-gray-500">Status:</span>
            <span
              className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                status === 'scheduled'
                  ? 'bg-yellow-100 text-yellow-800'
                  : status === 'live'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
          </div>

          {currentScheduledTime && (
            <div className="space-y-1">
              <div>
                <span className="text-sm font-medium text-gray-500">Scheduled Start:</span>
                <span className="ml-2 text-gray-900">
                  {formatInTimezone(new Date(currentScheduledTime), userTimeZone, 'PPP p')}
                </span>
              </div>
              <div className="text-xs text-gray-500 ml-2">
                {getTimezoneInfo(userTimeZone).name} ({getTimezoneInfo(userTimeZone).offset})
              </div>
            </div>
          )}

          <div>
            <span className="text-sm font-medium text-gray-500">Time Per Pick:</span>
            <span className="ml-2 text-gray-900">{currentTimePerPick} seconds</span>
          </div>

          {status === 'live' && (
            <div className="mt-4 p-3 bg-green-50 rounded-md">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></div>
                <span className="text-sm font-medium text-green-800">Draft is currently live!</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <FormField label="Scheduled Start Time *">
            <input
              type="datetime-local"
              value={formData.scheduledTime}
              onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value })}
              min={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </FormField>

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
              Current time in selected timezone: {getTimezoneInfo(formData.timeZone).currentTime}
            </div>
          </FormField>

          <FormField label="Time Per Pick (seconds) *">
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

          <FormField label="Reminders">
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

          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleUpdateSchedule}
              disabled={isLoading || !formData.scheduledTime}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Updating...' : 'Update Schedule'}
            </Button>
            <Button
              onClick={handleCancel}
              disabled={isLoading}
              className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {/* Confirmation modal for starting draft immediately (cancels existing schedule).
          Uses onConfirm to DELETE the current schedule and begin the draft, with destructive styling. */}
      {ConfirmationModal}
    </div>
  );
}
