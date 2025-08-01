import React from "react";

interface StatFiltersProps {
  statQualifier: string;
  setStatQualifier: (value: string) => void;
  statThreshold: number;
  setStatThreshold: (value: number) => void;
  timeframe: string;
  setTimeframe: (value: string) => void;
}

const statOptions = [
  { value: "kicks", label: "Kicks" },
  { value: "marks", label: "Marks" },
  { value: "goals", label: "Goals" },
  { value: "tackles", label: "Tackles" },
  { value: "disposals", label: "Disposals" }
];

const timeframeOptions = [
  { value: "season", label: "Season" },
  { value: "last5", label: "Last 5" },
  { value: "last10", label: "Last 10" },
];

const StatFilters: React.FC<StatFiltersProps> = ({
  statQualifier,
  setStatQualifier,
  statThreshold,
  setStatThreshold,
  timeframe,
  setTimeframe,
}) => (
  <div className="stat-filter">
    <label>
      Stat:
      <select
        className="stat-select ml-2"
        value={statQualifier}
        onChange={(e) => setStatQualifier(e.target.value)}
      >
        {statOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
    <label>
      Min:
      <input
        className="stat-input ml-2"
        type="number"
        value={statThreshold}
        min={0}
        onChange={(e) => {
          const value = e.target.value;
          setStatThreshold(value === "" ? 0 : Number(value));
        }}
        style={{ width: 60 }}
      />
    </label>
    <label>
      Timeframe:
      <select
        className="stat-select ml-2"
        value={timeframe}
        onChange={(e) => setTimeframe(e.target.value)}
      >
        {timeframeOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  </div>
);

export default StatFilters;