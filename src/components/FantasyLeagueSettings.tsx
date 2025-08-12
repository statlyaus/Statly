"use client";

import { useState } from 'react';
import { FANTASY_CATEGORIES, type FantasyCategoryKey, type LeagueSettings } from '@/types/fantasyCategories';
import Button from '@/components/Button';

interface FantasyLeagueSettingsProps {
  initialSettings?: LeagueSettings;
  onSave: (settings: LeagueSettings) => void;
  onCancel: () => void;
  maxCategories?: number;
}

export default function FantasyLeagueSettings({
  initialSettings,
  onSave,
  onCancel,
  maxCategories = 9
}: FantasyLeagueSettingsProps) {
  const [selectedCategories, setSelectedCategories] = useState<FantasyCategoryKey[]>(
    initialSettings?.selectedCategories || []
  );
  const [categoryWeights, setCategoryWeights] = useState<Record<FantasyCategoryKey, number>>(
    initialSettings?.categoryWeights || {} as Record<FantasyCategoryKey, number>
  );

  const handleCategoryToggle = (category: FantasyCategoryKey) => {
    setSelectedCategories(prev => {
      if (prev.includes(category)) {
        // Remove category
        const newCategories = prev.filter(c => c !== category);
        // Remove from weights too
        const newWeights = { ...categoryWeights };
        delete newWeights[category];
        setCategoryWeights(newWeights);
        return newCategories;
      } else {
        // Add category if under limit
        if (prev.length < maxCategories) {
          // Set default weight
          setCategoryWeights(prev => ({ ...prev, [category]: 1 }));
          return [...prev, category];
        }
        return prev;
      }
    });
  };

  const handleWeightChange = (category: FantasyCategoryKey, weight: number) => {
    setCategoryWeights(prev => ({ ...prev, [category]: weight }));
  };

  const handleSave = () => {
    const settings: LeagueSettings = {
      id: initialSettings?.id || '',
      name: initialSettings?.name || '',
      selectedCategories: selectedCategories,
      categoryWeights,
      maxCategories,
      scoringType: 'total'
    };
    onSave(settings);
  };

  const isAtLimit = selectedCategories.length >= maxCategories;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Fantasy Scoring Categories</h3>
        <p className="text-gray-600 text-sm mb-4">
          Select up to {maxCategories} statistical categories for fantasy scoring. 
          Selected: {selectedCategories.length}/{maxCategories}
        </p>
      </div>

      {/* Category Groups */}
      <div className="space-y-6">
        {/* Basic Stats */}
        <div>
          <h4 className="font-medium text-gray-800 mb-3">Basic Statistics</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(['kicks', 'handballs', 'marks', 'tackles', 'goals', 'hitouts'] as FantasyCategoryKey[]).map(category => (
              <CategoryCard
                key={category}
                category={category}
                isSelected={selectedCategories.includes(category)}
                weight={categoryWeights[category] || 1}
                onToggle={() => handleCategoryToggle(category)}
                onWeightChange={(weight) => handleWeightChange(category, weight)}
                disabled={!selectedCategories.includes(category) && isAtLimit}
              />
            ))}
          </div>
        </div>

        {/* Advanced Stats */}
        <div>
          <h4 className="font-medium text-gray-800 mb-3">Advanced Statistics</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(['clearances', 'inside50s', 'rebound50s', 'clangers', 'contestedPossessions', 'uncontestedPossessions'] as FantasyCategoryKey[]).map(category => (
              <CategoryCard
                key={category}
                category={category}
                isSelected={selectedCategories.includes(category)}
                weight={categoryWeights[category] || 1}
                onToggle={() => handleCategoryToggle(category)}
                onWeightChange={(weight) => handleWeightChange(category, weight)}
                disabled={!selectedCategories.includes(category) && isAtLimit}
              />
            ))}
          </div>
        </div>

        {/* Discipline & Efficiency */}
        <div>
          <h4 className="font-medium text-gray-800 mb-3">Discipline & Efficiency</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(['freesFor', 'freesAgainst', 'onePercenters', 'goalAssists', 'timeOnGround', 'disposalEfficiency'] as FantasyCategoryKey[]).map(category => (
              <CategoryCard
                key={category}
                category={category}
                isSelected={selectedCategories.includes(category)}
                weight={categoryWeights[category] || 1}
                onToggle={() => handleCategoryToggle(category)}
                onWeightChange={(weight) => handleWeightChange(category, weight)}
                disabled={!selectedCategories.includes(category) && isAtLimit}
              />
            ))}
          </div>
        </div>

        {/* Elite Stats */}
        <div>
          <h4 className="font-medium text-gray-800 mb-3">Elite Statistics</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(['turnovers', 'intercepts', 'metresGained', 'contestedMarks', 'effectiveDisposals', 'scoreInvolvements'] as FantasyCategoryKey[]).map(category => (
              <CategoryCard
                key={category}
                category={category}
                isSelected={selectedCategories.includes(category)}
                weight={categoryWeights[category] || 1}
                onToggle={() => handleCategoryToggle(category)}
                onWeightChange={(weight) => handleWeightChange(category, weight)}
                disabled={!selectedCategories.includes(category) && isAtLimit}
              />
            ))}
          </div>
        </div>

        {/* Computed Stats */}
        <div>
          <h4 className="font-medium text-gray-800 mb-3">Fantasy Scoring</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(['totalValue'] as FantasyCategoryKey[]).map(category => (
              <CategoryCard
                key={category}
                category={category}
                isSelected={selectedCategories.includes(category)}
                weight={categoryWeights[category] || 1}
                onToggle={() => handleCategoryToggle(category)}
                onWeightChange={(weight) => handleWeightChange(category, weight)}
                disabled={!selectedCategories.includes(category) && isAtLimit}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t">
        <Button onClick={handleSave} className="bg-blue-600 text-white hover:bg-blue-700">
          Save Settings
        </Button>
        <Button onClick={onCancel} variant="secondary">
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface CategoryCardProps {
  category: FantasyCategoryKey;
  isSelected: boolean;
  weight: number;
  onToggle: () => void;
  onWeightChange: (weight: number) => void;
  disabled: boolean;
}

function CategoryCard({ category, isSelected, weight, onToggle, onWeightChange, disabled }: CategoryCardProps) {
  const categoryInfo = FANTASY_CATEGORIES[category];

  return (
    <div className={`border rounded-lg p-3 transition-colors ${
      isSelected 
        ? 'border-blue-500 bg-blue-50' 
        : disabled
        ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
        : 'border-gray-300 bg-white hover:border-blue-300'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggle}
              disabled={disabled}
              className="text-blue-600"
            />
            <span className="font-medium text-sm">{categoryInfo.label}</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-1 rounded">
              {categoryInfo.abbrev}
            </span>
          </div>
          <p className="text-xs text-gray-600 mt-1">{categoryInfo.description}</p>
        </div>
      </div>
      
      {isSelected && (
        <div className="mt-2">
          <label htmlFor={`weight-${category}`} className="block text-xs text-gray-600 mb-1">Weight:</label>
          <input
            id={`weight-${category}`}
            type="number"
            value={weight}
            onChange={(e) => onWeightChange(Number(e.target.value) || 1)}
            min="0.1"
            max="10"
            step="0.1"
            className="w-full px-2 py-1 text-xs border rounded"
          />
        </div>
      )}
    </div>
  );
}
