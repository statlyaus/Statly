import { motion } from 'framer-motion';

interface InjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

interface TeamInjuries {
  team: string;
  players: InjuryData[];
}

interface InjuryListDisplayProps {
  injuries: InjuryData[];
  groupByTeam?: boolean;
}

export default function InjuryListDisplay({ injuries, groupByTeam = true }: InjuryListDisplayProps) {
  if (injuries.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h4 className="font-medium text-slate-900 mb-1">No Injuries Reported</h4>
        <p className="text-sm text-slate-600">All players are currently healthy</p>
      </div>
    );
  }

  if (groupByTeam) {
    // Group injuries by team
    const teamGroups = injuries.reduce((acc, injury) => {
      const existingTeam = acc.find(team => team.team === injury.team);
      if (existingTeam) {
        existingTeam.players.push(injury);
      } else {
        acc.push({
          team: injury.team,
          players: [injury]
        });
      }
      return acc;
    }, [] as TeamInjuries[]);

    // Sort teams alphabetically
    teamGroups.sort((a, b) => a.team.localeCompare(b.team));

    return (
      <div className="space-y-4">
        {teamGroups.map((teamGroup, teamIndex) => (
          <motion.div
            key={teamGroup.team}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: teamIndex * 0.1 }}
            className="border border-slate-200 rounded-lg overflow-hidden"
          >
            {/* Team header */}
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-900">
                  {teamGroup.team}
                </h4>
                <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded-full">
                  {teamGroup.players.length} {teamGroup.players.length === 1 ? 'player' : 'players'}
                </span>
              </div>
            </div>

            {/* Players list */}
            <div className="divide-y divide-slate-100">
              {teamGroup.players.map((injury, playerIndex) => (
                <motion.div
                  key={`${injury.name}-${playerIndex}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: (teamIndex * 0.1) + (playerIndex * 0.05) }}
                  className="p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <h5 className="font-medium text-slate-900">{injury.name}</h5>
                        <div className="flex items-center space-x-1">
                          <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                          <span className="text-sm text-red-700 font-medium">{injury.injury}</span>
                        </div>
                      </div>
                      <div className="mt-1 flex items-center space-x-4 text-sm text-slate-600">
                        <span className="flex items-center space-x-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Return: {injury.expectedReturn || injury.status || 'Unknown'}</span>
                        </span>
                        {injury.position && injury.position !== 'Unknown' && (
                          <span className="text-slate-500">• {injury.position}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    );
  }

  // Simple list view (not grouped by team)
  return (
    <div className="space-y-3">
      {injuries.map((injury, index) => (
        <motion.div
          key={`${injury.name}-${index}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className="p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <h5 className="font-medium text-slate-900">{injury.name}</h5>
                <span className="text-sm text-slate-500">({injury.team})</span>
                <div className="flex items-center space-x-1">
                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                  <span className="text-sm text-red-700 font-medium">{injury.injury}</span>
                </div>
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Return: {injury.expectedReturn || injury.status || 'Unknown'}
                {injury.position && injury.position !== 'Unknown' && (
                  <span className="ml-2 text-slate-500">• {injury.position}</span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
