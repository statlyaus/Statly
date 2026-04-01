'use client';

import { useState, useEffect } from 'react';

import { useAuth } from '@/AuthContext';
import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { AppLayout } from '@/components/navigation';
import { LoadingSpinner, UIInput, UISelect, UISwitch } from '@/components/ui';
import { fetchApi } from '@/lib/api';

interface DraftPreferences {
  autoPickEnabled: boolean;
  autoPickTime: number;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  defaultTimePerPick: number;
  preferredDraftType: 'SNAKE' | 'LINEAR';
  timezone: string;
}

export default function DraftSettingsClient() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<DraftPreferences>({
    autoPickEnabled: false,
    autoPickTime: 120,
    notificationsEnabled: true,
    soundEnabled: true,
    defaultTimePerPick: 120,
    preferredDraftType: 'SNAKE',
    timezone: 'Australia/Melbourne',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      if (!user) return;
      try {
        setIsLoading(true);
        const response = await fetchApi('user/draft-settings');
        if (response.success) setPreferences(response.data);
      } catch (err) {
        console.error('Error loading draft settings:', err);
      } finally {
        setIsLoading(false);
      }
    };
    const detectTimezone = () => {
      try {
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (userTimezone) setPreferences((prev) => ({ ...prev, timezone: userTimezone }));
      } catch (err) {
        setPreferences((prev) => ({ ...prev, timezone: 'UTC' }));
      }
    };
    loadSettings();
    detectTimezone();
  }, [user]);

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
      if (response.success) setMessage({ type: 'success', text: 'Settings saved successfully!' });
      else setMessage({ type: 'error', text: response.error || 'Failed to save settings' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setPreferences({
      autoPickEnabled: false,
      autoPickTime: 120,
      notificationsEnabled: true,
      soundEnabled: true,
      defaultTimePerPick: 120,
      preferredDraftType: 'SNAKE',
      timezone: 'Australia/Melbourne',
    });
    setMessage(null);
  };

  if (!user) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Sign in Required</h1>
            <p className="text-gray-600">Please sign in to manage your draft settings.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <main className="mx-auto max-w-4xl p-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Draft Settings</h1>
          <p className="text-gray-600 mt-2">Customize your draft experience and preferences.</p>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
            <span className="ml-3 text-gray-600">Loading settings...</span>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Auto-Pick Settings</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Enable Auto-Pick</label>
                    <p className="text-sm text-gray-500">
                      Automatically pick players when your time runs out
                    </p>
                  </div>
                  <UISwitch
                    checked={preferences.autoPickEnabled}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) => ({ ...prev, autoPickEnabled: checked }))
                    }
                  />
                </div>
                {preferences.autoPickEnabled && (
                  <FormField label="Auto-Pick Time (seconds)">
                    <UISelect
                      value={preferences.autoPickTime}
                      onChange={(e) =>
                        setPreferences((prev) => ({
                          ...prev,
                          autoPickTime: parseInt(e.target.value),
                        }))
                      }
                    >
                      <option value={30}>30 seconds</option>
                      <option value={60}>1 minute</option>
                      <option value={90}>1.5 minutes</option>
                      <option value={120}>2 minutes</option>
                      <option value={180}>3 minutes</option>
                    </UISelect>
                  </FormField>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Notification Settings</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Enable Notifications
                    </label>
                    <p className="text-sm text-gray-500">
                      Receive browser notifications during drafts
                    </p>
                  </div>
                  <UISwitch
                    checked={preferences.notificationsEnabled}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) => ({
                        ...prev,
                        notificationsEnabled: checked,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Enable Sound</label>
                    <p className="text-sm text-gray-500">Play sounds for draft events</p>
                  </div>
                  <UISwitch
                    checked={preferences.soundEnabled}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) => ({ ...prev, soundEnabled: checked }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Default Draft Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Default Time Per Pick">
                  <UISelect
                    value={preferences.defaultTimePerPick}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        defaultTimePerPick: parseInt(e.target.value),
                      }))
                    }
                  >
                    <option value={60}>1 minute</option>
                    <option value={90}>1.5 minutes</option>
                    <option value={120}>2 minutes</option>
                    <option value={180}>3 minutes</option>
                    <option value={300}>5 minutes</option>
                  </UISelect>
                </FormField>
                <FormField label="Preferred Draft Type">
                  <UISelect
                    value={preferences.preferredDraftType}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        preferredDraftType: e.target.value as 'SNAKE' | 'LINEAR',
                      }))
                    }
                  >
                    <option value="SNAKE">Snake</option>
                    <option value="LINEAR">Linear</option>
                  </UISelect>
                </FormField>
                <FormField label="Timezone">
                  <UIInput
                    type="text"
                    value={preferences.timezone}
                    onChange={(e) =>
                      setPreferences((prev) => ({ ...prev, timezone: e.target.value }))
                    }
                  />
                </FormField>
              </div>
            </div>

            {message && (
              <div
                className={`rounded-md p-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
              >
                {message.text}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                loading={isSaving}
              >
                {isSaving ? 'Saving…' : 'Save Settings'}
              </Button>
              <Button type="button" onClick={handleReset} variant="secondary">
                Reset Defaults
              </Button>
            </div>
          </div>
        )}
      </main>
    </AppLayout>
  );
}
