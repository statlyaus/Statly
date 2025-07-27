import { useEffect, useState } from "react";
import Papa from "papaparse";
import type { Player } from "../types";
import PlayerList from "../Components/PlayerList";

const PlayersPage = () => {
  const [myTeam, setMyTeam] = useState<Player[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);

  useEffect(() => {
    fetch("/players.csv")
      .then((res) => res.text())
      .then((csvText) => {
        const parsed = Papa.parse<Player>(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
        });
        if (parsed.data) {
          const allPlayers = parsed.data;
          setMyTeam(allPlayers.slice(0, 10));
          setAvailablePlayers(allPlayers.slice(10, 30));
        }
      });
  }, []);

  return (
    <div>
      <PlayerList title="My Team" players={myTeam} />
      <PlayerList title="Available Players" players={availablePlayers} />
    </div>
  );
};

export default PlayersPage;