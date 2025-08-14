'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { XMarkIcon, PhotoIcon } from '@heroicons/react/24/outline';

interface TeamSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  initialTeamName?: string;
  onSave: (teamName: string, logoUrl?: string) => void;
}

export default function TeamSettings({ isOpen, onClose, initialTeamName = '', onSave }: TeamSettingsProps) {
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
        className="bg-white rounded-xl p-6 w-full max-w-md mx-4"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Team Settings</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Team Name */}
          <div>
            <label htmlFor="teamName" className="block text-sm font-medium text-gray-700 mb-2">
              Team Name
            </label>
            <input
              id="teamName"
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your team name"
              maxLength={50}
            />
            <p className="mt-1 text-xs text-gray-500">
              {teamName.length}/50 characters
            </p>
          </div>

          {/* Team Logo */}
          <div>
            <label htmlFor="logoUrl" className="block text-sm font-medium text-gray-700 mb-2">
              Team Logo (Optional)
            </label>
            <div className="flex items-center space-x-3">
              <div className="flex-1">
                <input
                  id="logoUrl"
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="https://example.com/logo.png"
                />
              </div>
              {logoUrl && (
                <div className="w-10 h-10 border border-gray-200 rounded-lg flex items-center justify-center bg-gray-50">
                  <img
                    src={logoUrl}
                    alt="Team logo preview"
                    className="w-8 h-8 rounded object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'block';
                    }}
                  />
                  <PhotoIcon className="w-4 h-4 text-gray-400 hidden" />
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Provide a URL to an image for your team logo
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading || !teamName.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Saving...' : 'Save Team Settings'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
