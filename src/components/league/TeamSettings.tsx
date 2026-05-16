'use client';

import { useState } from 'react';

import { motion } from 'framer-motion';
import { Image, X } from 'lucide-react';

import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { UIInput } from '@/components/ui';
import { leagueSurfacePatterns } from '@/styles/leagueDesignSystem';

interface TeamSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  initialTeamName?: string;
  onSave: (teamName: string, logoUrl?: string) => void;
}

export default function TeamSettings({
  isOpen,
  onClose,
  initialTeamName = '',
  onSave,
}: TeamSettingsProps) {
  const [teamName, setTeamName] = useState(initialTeamName);
  const [logoUrl, setLogoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async () => {
    if (!teamName.trim()) return;

    setIsLoading(true);
    try {
      await onSave(teamName.trim(), logoUrl.trim() || undefined);
      onClose();
    } catch (error) {
      console.error('Error saving team settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`${leagueSurfacePatterns.panelSection} mx-4 w-full max-w-md`}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[color:var(--league-text)]">Team Settings</h3>
          <button
            onClick={onClose}
            aria-label="Close team settings"
            className="text-[color:var(--league-text-muted)] transition-colors hover:text-[color:var(--league-text)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Team Name */}
          <FormField label="Team Name" id="teamName">
            <UIInput
              id="teamName"
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Enter your team name"
              maxLength={50}
            />
            <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">
              {teamName.length}/50 characters
            </p>
          </FormField>

          {/* Team Logo */}
          <FormField label="Team Logo (Optional)" id="logoUrl">
            <div className="flex items-center space-x-3">
              <div className="flex-1">
                <UIInput
                  id="logoUrl"
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                />
              </div>
              {logoUrl && (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)]">
                  <img
                    src={logoUrl}
                    alt="Team logo preview"
                    className="h-8 w-8 rounded object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'block';
                    }}
                  />
                  <Image
                    className="hidden h-4 w-4 text-[color:var(--league-text-muted)]"
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">
              Provide a URL to an image for your team logo
            </p>
          </FormField>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 border-t border-[color:var(--league-border)] pt-4">
            <Button onClick={onClose} disabled={isLoading} variant="secondary">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isLoading || !teamName.trim()}>
              {isLoading ? 'Saving...' : 'Save Team Settings'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
