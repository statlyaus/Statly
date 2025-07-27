import React from "react";

interface StatFiltersProps {
  statQualifier: string;
  setStatQualifier: (value: string) => void;
  statThreshold: number;
  setStatThreshold: (value: number) => void;
  timeframe: string;
  setTimeframe: (value: string) => void;
}

const StatFilters: React.FC<StatFiltersProps> = ({
  statQualifier,
  setStatQualifier,
  statThreshold,
  setStatThreshold,
  timeframe,
  setTimeframe,
}) => {
  return (
    <div className="sticky-filters">
      <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
        <option value="season">Season Avg</option>
        <option value="last3">Last 3</option>
        <option value="last5">Last 5</option>
        <option value="24months">24 Months</option>
      </select>

      <select value={statQualifier} onChange={(e) => setStatQualifier(e.target.value)}>
        <option value="kicks">Kicks</option>
        <option value="handballs">Handballs</option>
        <option value="marks">Marks</option>
        <option value="tackles">Tackles</option>
        <option value="goals">Goals</option>
        <option value="hitouts">Hitouts</option>
        <option value="clearances">Clearances</option>
        <option value="inside50s">Inside 50s</option>
        <option value="rebound50s">Rebound 50s</option>
        <option value="contestedPossessions">Contested Possessions</option>
      </select>

      <input
        type="number"
        value={statThreshold}
        onChange={(e) => setStatThreshold(Number(e.target.value))}
        placeholder="Min Threshold"
      />
    </div>
  );
};

export default StatFilters;