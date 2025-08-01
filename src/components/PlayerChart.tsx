import React from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

type Props = {
  playerName: string;
  labels: string[];
  data: number[];
};

const PlayerChart: React.FC<Props> = ({ playerName, labels, data }) => {
  return (
    <div className="bg-white p-4 rounded shadow">
      <h2 className="text-xl font-bold mb-2">{playerName} - Performance</h2>
      <Line
        data={{
          labels,
          datasets: [
            {
              label: "Fantasy Points",
              data,
              borderColor: "#2563eb",
              backgroundColor: "rgba(37, 99, 235, 0.3)",
              fill: true,
              tension: 0.4,
            },
          ],
        }}
        options={{
          responsive: true,
          plugins: {
            legend: { display: true },
          },
          scales: {
            y: {
              beginAtZero: true,
            },
          },
        }}
      />
    </div>
  );
};

export default PlayerChart;