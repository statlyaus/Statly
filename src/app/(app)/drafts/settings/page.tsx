'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/AuthContext';
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

export default function DraftSettingsPage() {
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

        if (response.success) {
          setPreferences(response.data);
        }
      } catch (err) {
        console.error('Error loading draft settings:', err);
        // Use default settings if loading fails
      } finally {
        setIsLoading(false);
      }
    };

    // Detect user's timezone on first load
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

      if (response.success) {
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to save settings' });
      }
    } catch (_err) {
      console.error('Failed to save draft settings:', _err);
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
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-4">Sign in Required</h1>
            <p className="text-muted-foreground">Please sign in to manage your draft settings.</p>
          </div>
        </div>
    );
  }

  return (
      <div className="mx-auto max-w-4xl p-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Draft Settings</h1>
          <p className="text-muted-foreground mt-2">Customize your draft experience and preferences.</p>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-bar"></div>
            <span className="ml-3 text-muted-foreground">Loading settings...</span>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Auto-Pick Settings */}
            <div className="bg-card text-card-foreground rounded-lg shadow-sm border border-border p-6">
              <h2 className="text-xl font-semibold text-foreground mb-4">Auto-Pick Settings</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label
                      htmlFor="auto-pick-enabled"
                      className="text-sm font-medium text-foreground"
                    >
                      Enable Auto-Pick
                    </label>
                    <p className="text-sm text-muted-foreground">
                      Automatically pick players when your time runs out
                    </p>
                  </div>
                  <input
                    id="auto-pick-enabled"
                    type="checkbox"
                    checked={preferences.autoPickEnabled}
                    onChange={(e) =>
                      setPreferences((prev) => ({ ...prev, autoPickEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 text-brand-bar focus:ring-ring border-input rounded"
                  />
                </div>

                {preferences.autoPickEnabled && (
                  <div>
                    <label
                      htmlFor="auto-pick-time"
                      className="block text-sm font-medium text-foreground mb-2"
                    >
                      Auto-Pick Time (seconds)
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
                      className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-md focus:ring-2 focus:ring-ring focus:border-transparent"
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
            </div>

            {/* Notification Settings */}
            <div className="bg-card text-card-foreground rounded-lg shadow-sm border border-border p-6">
              <h2 className="text-xl font-semibold text-foreground mb-4">Notification Settings</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label
                      htmlFor="notifications-enabled"
                      className="text-sm font-medium text-foreground"
                    >
                      Enable Notifications
                    </label>
                    <p className="text-sm text-muted-foreground">
                      Receive browser notifications during drafts
                    </p>
                  </div>
                  <input
                    id="notifications-enabled"
                    type="checkbox"
                    checked={preferences.notificationsEnabled}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        notificationsEnabled: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 text-brand-bar focus:ring-ring border-input rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label htmlFor="sound-enabled" className="text-sm font-medium text-foreground">
                      Enable Sound
                    </label>
                    <p className="text-sm text-muted-foreground">Play sounds for draft events</p>
                  </div>
                  <input
                    id="sound-enabled"
                    type="checkbox"
                    checked={preferences.soundEnabled}
                    onChange={(e) =>
                      setPreferences((prev) => ({ ...prev, soundEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 text-brand-bar focus:ring-ring border-input rounded"
                  />
                </div>
              </div>
            </div>

            {/* Default Draft Settings */}
            <div className="bg-card text-card-foreground rounded-lg shadow-sm border border-border p-6">
              <h2 className="text-xl font-semibold text-foreground mb-4">Default Draft Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="default-time-per-pick"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Default Time Per Pick
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
                    className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-md focus:ring-2 focus:ring-ring focus:border-transparent"
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
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Preferred Draft Type
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
                    className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-md focus:ring-2 focus:ring-ring focus:border-transparent"
                  >
                    <option value="SNAKE">Snake Draft</option>
                    <option value="LINEAR">Linear Draft</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Message Display */}
            {message && (
              <div
                className={`p-4 rounded-lg ${
                  message.type === 'success'
                    ? 'bg-[color:var(--league-success-soft)] border border-[color:var(--league-success)] text-[color:var(--league-success)]'
                    : 'bg-[color:var(--league-danger-soft)] border border-[color:var(--league-danger)] text-[color:var(--league-danger)]'
                }`}
              >
                {message.text}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-6 border-t border-border">
              <button
                onClick={handleReset}
                className="px-4 py-2 text-foreground border border-input rounded-md hover:bg-muted transition-colors"
              >
                Reset to Defaults
              </button>

              <div className="flex space-x-3">
                <button
                  onClick={() => window.history.back()}
                  className="px-4 py-2 text-foreground border border-input rounded-md hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-6 py-2 bg-brand-bar text-brand-bar-foreground rounded-md hover:bg-brand-bar/90 disabled:opacity-50 transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
