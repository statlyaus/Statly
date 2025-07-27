import { useState } from "react";
import StatFilters from "../Components/StatFilters";

export default function Stats() {
  const [statQualifier, setStatQualifier] = useState("kicks");
  const [statThreshold, setStatThreshold] = useState(0);
  const [timeframe, setTimeframe] = useState("season");

  console.log("Rendering Stats Page", { statQualifier, statThreshold, timeframe });

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-2">Stats</h2>
      <p className="mb-4">Here you’ll find player and match statistics.</p>
      <StatFilters
        statQualifier={statQualifier}
        setStatQualifier={setStatQualifier}
        statThreshold={statThreshold}
        setStatThreshold={setStatThreshold}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
      />
      <div className="mt-4">
        <table className="min-w-full border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-2 border">Player</th>
              <th className="p-2 border capitalize">{statQualifier}</th>
            </tr>
          </thead>
          <tbody>
            {statThreshold >= 0 ? (
              <tr>
                <td className="p-2 border">Sample Player</td>
                <td className="p-2 border">{statThreshold + 10}</td>
              </tr>
            ) : (
              <tr>
                <td className="p-2 border" colSpan={2}>No data available</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}