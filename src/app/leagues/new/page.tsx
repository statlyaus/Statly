'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Form from '@/components/Form';
import FormField from '@/components/FormField';
import Button from '@/components/Button';
import { fetchFromAPI } from '@/lib/api';
import type { CreateLeagueRequest, League } from '@/types/leagues';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';

const AVAILABLE_CATEGORIES: FantasyCategoryKey[] = [
  'goals',
  'goalAssists', 
  'tackles',
  'clearances',
  'inside50s',
  'rebound50s',
  'intercepts',
  'contestedMarks',
  'metresGained',
  'scoreInvolvements',
  'effectiveDisposals',
  'disposalEffPct',
  'clangers',
  'turnovers',
  'marks',
  'kicks',
  'handballs',
  'hitouts',
];

export default function NewLeaguePage() {
  const [formData, setFormData] = useState<Partial<CreateLeagueRequest>>({
    name: '',
    type: 'public',
    maxTeams: 10,
    categories: ['goals', 'marks', 'tackles', 'effectiveDisposals'],
    description: '',
    tradeSettings: {
      tradeLimit: 10,
      tradeReview: 'none',
    },
    waiverWire: {
      waiverPeriodHours: 24,
      waiverResetPolicy: 'weekly',
    },
    draftDate: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleInputChange = (field: keyof CreateLeagueRequest, value: string | number | FantasyCategoryKey[]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleCategoryToggle = (category: FantasyCategoryKey) => {
    setFormData(prev => ({
      ...prev,
      categories: prev.categories?.includes(category)
        ? prev.categories.filter(c => c !== category)
        : [...(prev.categories || []), category]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    console.log('🚀 Form submission started');
    console.log('📝 Form data:', formData);

    try {
      const response = await fetchFromAPI<{ data: League }>(
        '/api/leagues',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        },
      );
      console.log('✅ League created successfully:', response);
      router.push(`/leagues/${response.data.id}`);
    } catch (err: unknown) {
      console.error('❌ League creation failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to create league';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Create New League</h1>
          <p className="text-lg text-gray-600">Set up your fantasy AFL league with custom settings</p>
        </div>

        <Form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl shadow-lg p-6 space-y-6"
          >
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">League Information</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField label="League Name *">
                <input
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  placeholder="Enter league name"
                  required
                />
              </FormField>

              <FormField label="League Type">
                <select
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={formData.type}
                  onChange={(e) => handleInputChange('type', e.target.value as 'public' | 'private')}
                >
                  <option value="public">Public - Anyone can join</option>
                  <option value="private">Private - Invite only</option>
                </select>
              </FormField>

              <FormField label="Max Teams *">
                <select
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={formData.maxTeams}
                  onChange={(e) => handleInputChange('maxTeams', parseInt(e.target.value))}
                >
                  {[6, 8, 10, 12, 14, 16, 18, 20].map(num => (
                    <option key={num} value={num}>{num} Teams</option>
                  ))}
                </select>
              </FormField>

              <FormField label="Draft Date (Optional)">
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={formData.draftDate}
                  onChange={(e) => handleInputChange('draftDate', e.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Description (Optional)">
              <textarea
                className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={3}
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="Describe your league..."
              />
            </FormField>
          </motion.div>

          {/* Scoring Categories */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-xl shadow-lg p-6 space-y-6"
          >
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Scoring Categories</h2>
            <p className="text-gray-600 mb-4">Select which stats will count toward player rankings (3-8 categories recommended)</p>
            
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {AVAILABLE_CATEGORIES.map((category) => {
                const categoryData = FANTASY_CATEGORIES[category];
                return (
                  <label
                    key={category}
                    className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      formData.categories?.includes(category)
                        ? 'border-blue-500 bg-blue-50 text-blue-900'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.categories?.includes(category) || false}
                      onChange={() => handleCategoryToggle(category)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium">{categoryData.label}</span>
                  </label>
                );
              })}
            </div>
            
            <p className="text-sm text-gray-500">
              Selected: {formData.categories?.length || 0} categories
            </p>
          </motion.div>

          {/* Trade Settings */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-xl shadow-lg p-6 space-y-6"
          >
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Trade Settings</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField label="Max Trades Per Team">
                <select
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={formData.tradeSettings?.tradeLimit || 10}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    tradeSettings: {
                      ...prev.tradeSettings,
                      tradeLimit: parseInt(e.target.value)
                    }
                  }))}
                >
                  <option value={5}>5 Trades</option>
                  <option value={8}>8 Trades</option>
                  <option value={10}>10 Trades</option>
                  <option value={15}>15 Trades</option>
                  <option value={99}>Unlimited</option>
                </select>
              </FormField>

              <FormField label="Trade Review Process">
                <select
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={formData.tradeSettings?.tradeReview || 'none'}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    tradeSettings: {
                      ...prev.tradeSettings,
                      tradeReview: e.target.value as 'none' | 'admin' | 'veto'
                    }
                  }))}
                >
                  <option value="none">Instant Processing</option>
                  <option value="admin">Admin Review</option>
                  <option value="veto">League Vote</option>
                </select>
              </FormField>
            </div>
          </motion.div>

          {/* Waiver Wire Settings */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-xl shadow-lg p-6 space-y-6"
          >
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Waiver Wire Settings</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField label="Waiver Processing Period">
                <select
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={formData.waiverWire?.waiverPeriodHours || 24}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    waiverWire: {
                      ...prev.waiverWire,
                      waiverPeriodHours: parseInt(e.target.value)
                    }
                  }))}
                >
                  <option value={0}>Instant</option>
                  <option value={24}>24 Hours</option>
                  <option value={48}>48 Hours</option>
                  <option value={72}>72 Hours</option>
                </select>
              </FormField>

              <FormField label="Waiver Order Reset">
                <select
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={formData.waiverWire?.waiverResetPolicy || 'weekly'}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    waiverWire: {
                      ...prev.waiverWire,
                      waiverResetPolicy: e.target.value as 'weekly' | 'rolling'
                    }
                  }))}
                >
                  <option value="rolling">Continuous rolling</option>
                  <option value="weekly">Weekly reset</option>
                </select>
              </FormField>
            </div>
          </motion.div>

          {/* Submit */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex justify-center space-y-4"
          >
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg w-full">
                <p className="text-red-600">{error}</p>
              </div>
            )}
            
            <Button 
              type="submit" 
              disabled={isLoading || !formData.name || (formData.categories?.length || 0) < 3}
              className="px-8 py-4 text-lg font-semibold"
            >
              {isLoading ? 'Creating League...' : 'Create League'}
            </Button>
          </motion.div>
        </Form>
      </motion.div>
    </main>
  );
}
