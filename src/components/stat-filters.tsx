'use client';
import React from 'react';

interface StatFiltersProps {
  statQualifier: string;
  setStatQualifier: (value: string) => void;
  statThreshold: number;
  setStatThreshold: (value: number) => void;
  timeframe: string;
  setTimeframe: (value: string) => void;
}

const statOptions = [
  { value: 'Kicks', label: 'Kicks' },
  { value: 'Handballs', label: 'Handballs' },
  { value: 'Marks', label: 'Marks' },
  { value: 'Tackles', label: 'Tackles' },
  { value: 'Goals', label: 'Goals' },
  { value: 'Hitouts', label: 'Hitouts' },
  { value: 'Clearances', label: 'Clearances' },
  { value: 'Inside 50s', label: 'Inside 50s' },
  { value: 'Rebound 50s', label: 'Rebound 50s' },
  { value: 'Clangers', label: 'Clangers' },
  { value: 'Contested Possessions', label: 'Contested Possessions' },
  { value: 'Uncontested Possessions', label: 'Uncontested Possessions' },
  { value: 'Frees For', label: 'Frees For' },
  { value: 'Frees Against', label: 'Frees Against' },
  { value: 'One Percenters', label: 'One Percenters' },
  { value: 'Goal Assists', label: 'Goal Assists' },
  { value: 'Time on Ground %', label: 'Time on Ground %' },
  { value: 'Disposal Efficiency %', label: 'Disposal Efficiency %' },
  { value: 'Turnovers', label: 'Turnovers' },
  { value: 'Intercepts', label: 'Intercepts' },
  { value: 'Metres Gained', label: 'Metres Gained' },
  { value: 'Contested Marks', label: 'Contested Marks' },
  { value: 'Effective Disposals', label: 'Effective Disposals' },
  { value: 'Score Involvements', label: 'Score Involvements' },
];

const timeframeOptions = [
  { value: 'season', label: 'Season' },
  { value: 'last5', label: 'Last 5' },
  { value: 'last10', label: 'Last 10' },
];

const StatFilters: React.FC<StatFiltersProps> = ({
  statQualifier,
  setStatQualifier,
  statThreshold,
  setStatThreshold,
  timeframe,
  setTimeframe,
}) => (
  <fieldset className="flex flex-wrap gap-x-6 gap-y-4 items-end mb-6">
    <legend className="sr-only">Stat Filters</legend>

    {/* Stat Dropdown */}
    <label htmlFor="statSelect" className="flex flex-col text-sm font-medium text-gray-700">
      Stat
      <select
        id="statSelect"
        value={statQualifier}
        onChange={(e) => setStatQualifier(e.target.value)}
        className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {statOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>

    {/* Threshold Input */}
    <label htmlFor="minStat" className="flex flex-col text-sm font-medium text-gray-700">
      Min
      <input
        id="minStat"
        type="number"
        min={0}
        value={statThreshold}
        onChange={(e) => {
          const value = e.target.value;
          setStatThreshold(value === '' ? 0 : Number(value));
        }}
        className="mt-1 block w-20 rounded-md border border-gray-300 px-2 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </label>

    {/* Timeframe Dropdown */}
    <label htmlFor="timeframeSelect" className="flex flex-col text-sm font-medium text-gray-700">
      Timeframe
      <select
        id="timeframeSelect"
        value={timeframe}
        onChange={(e) => setTimeframe(e.target.value)}
        className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {timeframeOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  </fieldset>
);

export default StatFilters;
