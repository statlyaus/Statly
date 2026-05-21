'use client';

import { useState } from 'react';

import Button from '@/components/Button';
import { UICheckbox, UIInput } from '@/components/ui';
import {
  FANTASY_CATEGORIES,
  type FantasyCategoryKey,
  type LeagueSettings,
} from '@/types/fantasyCategories';

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
  maxCategories = 9,
}: FantasyLeagueSettingsProps) {
  const [selectedCategories, setSelectedCategories] = useState<FantasyCategoryKey[]>(
    initialSettings?.selectedCategories || []
  );
  const [categoryWeights, setCategoryWeights] = useState<Record<FantasyCategoryKey, number>>(
    initialSettings?.categoryWeights || ({} as Record<FantasyCategoryKey, number>)
  );

  const handleCategoryToggle = (category: FantasyCategoryKey) => {
    setSelectedCategories((prev) => {
      if (prev.includes(category)) {
        // Remove category
        const newCategories = prev.filter((c) => c !== category);
        // Remove from weights too
        const newWeights = { ...categoryWeights };
        delete newWeights[category];
        setCategoryWeights(newWeights);
        return newCategories;
      } else {
        // Add category if under limit
        if (prev.length < maxCategories) {
          // Set default weight
          setCategoryWeights((prev) => ({ ...prev, [category]: 1 }));
          return [...prev, category];
        }
        return prev;
      }
    });
  };

  const handleWeightChange = (category: FantasyCategoryKey, weight: number) => {
    setCategoryWeights((prev) => ({ ...prev, [category]: weight }));
  };

  const handleSave = () => {
    const settings: LeagueSettings = {
      id: initialSettings?.id || '',
      name: initialSettings?.name || '',
      selectedCategories: selectedCategories,
      categoryWeights,
      maxCategories,
      scoringType: 'total',
    };
    onSave(settings);
  };

  const isAtLimit = selectedCategories.length >= maxCategories;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Fantasy Scoring Categories</h3>
        <p className="text-muted-foreground text-sm mb-4">
          Select up to {maxCategories} statistical categories for fantasy scoring. Selected:{' '}
          {selectedCategories.length}/{maxCategories}
        </p>
      </div>

      {/* Category Groups */}
      <div className="space-y-6">
        {/* Basic Stats */}
        <div>
          <h4 className="font-medium text-foreground mb-3">Basic Statistics</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(
              ['kicks', 'handballs', 'marks', 'tackles', 'goals', 'hitouts'] as FantasyCategoryKey[]
            ).map((category) => (
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
          <h4 className="font-medium text-foreground mb-3">Advanced Statistics</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(
              [
                'clearances',
                'inside50s',
                'rebound50s',
                'clangers',
                'contestedPossessions',
                'uncontestedPossessions',
              ] as FantasyCategoryKey[]
            ).map((category) => (
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
          <h4 className="font-medium text-foreground mb-3">Discipline & Efficiency</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(
              [
                'freesFor',
                'freesAgainst',
                'onePercenters',
                'goalAssists',
                'timeOnGround',
                'disposalEfficiency',
              ] as FantasyCategoryKey[]
            ).map((category) => (
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
          <h4 className="font-medium text-foreground mb-3">Elite Statistics</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(
              [
                'turnovers',
                'intercepts',
                'metresGained',
                'contestedMarks',
                'effectiveDisposals',
                'scoreInvolvements',
              ] as FantasyCategoryKey[]
            ).map((category) => (
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

        {/* League Value Information */}
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
          <h4 className="font-medium text-primary mb-2 flex items-center gap-2">
            <span className="w-2 h-2 bg-primary rounded-full"></span>
            League Value Guidance
          </h4>
          <p className="text-sm text-primary">
            The League Value shows the combined per-game value of a player across your selected{' '}
            {selectedCategories.length} categories. This guidance metric helps you identify which
            players excel in your specific league scoring system.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t">
        <Button onClick={handleSave} className="bg-info text-white hover:bg-info">
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

function CategoryCard({
  category,
  isSelected,
  weight,
  onToggle,
  onWeightChange,
  disabled,
}: CategoryCardProps) {
  const categoryInfo = FANTASY_CATEGORIES[category];

  // Safety check for missing categories
  if (!categoryInfo) {
    console.warn(`Category "${category}" not found in FANTASY_CATEGORIES`);
    return null;
  }

  return (
    <div
      className={`border rounded-lg p-3 transition-colors ${
        isSelected
          ? 'border-info/20 bg-info/10'
          : disabled
            ? 'border-border bg-muted opacity-50 cursor-not-allowed'
            : 'border-border bg-white hover:border-info/20'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <UICheckbox checked={isSelected} onChange={onToggle} disabled={disabled} />
            <span className="font-medium text-sm">{categoryInfo.label}</span>
            <span className="text-xs text-muted-foreground bg-muted px-1 rounded">
              {categoryInfo.abbrev}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{categoryInfo.description}</p>
        </div>
      </div>

      {isSelected && (
        <div className="mt-2">
          <label htmlFor={`weight-${category}`} className="block text-xs text-muted-foreground mb-1">
            Weight:
          </label>
          <UIInput
            id={`weight-${category}`}
            type="number"
            value={weight}
            onChange={(e) => onWeightChange(Number(e.target.value) || 1)}
            min="0.1"
            max="10"
            step="0.1"
            className="h-8 text-xs"
          />
        </div>
      )}
    </div>
  );
}
