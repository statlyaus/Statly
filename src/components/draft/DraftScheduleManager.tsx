'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { Alert } from '@/components/ui';

interface DraftScheduleManagerProps {
  draftId: string;
  currentScheduledTime?: string;
  currentTimePerPick?: number;
  status: 'scheduled' | 'live' | 'completed';
  onScheduleUpdated?: () => void;
}

export default function DraftScheduleManager({
  draftId,
  currentScheduledTime,
  currentTimePerPick = 120,
  status,
  onScheduleUpdated,
}: DraftScheduleManagerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    scheduledTime: currentScheduledTime ? 
      format(new Date(currentScheduledTime), "yyyy-MM-dd'T'HH:mm") : '',
    timePerPick: currentTimePerPick,
  });

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
          scheduledTime: new Date(formData.scheduledTime).toISOString(),
          timePerPick: formData.timePerPick,
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
    if (!confirm('Are you sure you want to cancel the schedule and start the draft immediately?')) {
      return;
    }

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
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError(null);
    setSuccess(null);
    setFormData({
      scheduledTime: currentScheduledTime ? 
        format(new Date(currentScheduledTime), "yyyy-MM-dd'T'HH:mm") : '',
      timePerPick: currentTimePerPick,
    });
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
            <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
              status === 'scheduled' 
                ? 'bg-yellow-100 text-yellow-800'
                : status === 'live'
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-800'
            }`}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
          </div>
          
          {currentScheduledTime && (
            <div>
              <span className="text-sm font-medium text-gray-500">Scheduled Start:</span>
              <span className="ml-2 text-gray-900">
                {format(new Date(currentScheduledTime), 'PPP p')}
              </span>
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
    </div>
  );
}
