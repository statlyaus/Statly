import { motion } from 'framer-motion';

interface PlayerSpotlightModuleProps {
  refreshTrigger: number;
}

export default function PlayerSpotlightModule({ refreshTrigger: _refreshTrigger }: PlayerSpotlightModuleProps) {
  // Mock featured player - in real app, fetch from API
  const featuredPlayer = {
    id: 'christian-petracca',
    name: 'Christian Petracca',
    team: 'MEL',
    position: 'MID',
    imageUrl: '/api/placeholder/120/120',
    stats: {
      avgPoints: 127.3,
      lastRound: 142,
      ownership: 89.2,
      price: 785000,
    },
    form: [98, 115, 142, 128, 156, 142], // Last 6 rounds
    spotlight: 'Season average leader with exceptional consistency',
  };

  const getFormTrend = () => {
    const recent = featuredPlayer.form.slice(-3);
    const avg = recent.reduce((sum, score) => sum + score, 0) / recent.length;
    return avg > 120 ? 'excellent' : avg > 100 ? 'good' : 'average';
  };

  return (
    <div className="space-y-4">
      {/* Player Card */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg p-4 text-white">
        <div className="relative z-10">
          <div className="flex items-center space-x-3">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold">
                {featuredPlayer.name.split(' ').map(n => n[0]).join('')}
              </span>
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-lg">{featuredPlayer.name}</h4>
              <div className="flex items-center space-x-2 text-sm opacity-90">
                <span className="px-2 py-0.5 bg-white/20 rounded">{featuredPlayer.position}</span>
                <span>{featuredPlayer.team}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-32 h-32 transform rotate-12 translate-x-8 -translate-y-8">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="2"/>
              <circle cx="50" cy="50" r="20" fill="none" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900">{featuredPlayer.stats.avgPoints}</p>
          <p className="text-xs text-slate-600">Season Avg</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900">{featuredPlayer.stats.lastRound}</p>
          <p className="text-xs text-slate-600">Last Round</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900">{featuredPlayer.stats.ownership}%</p>
          <p className="text-xs text-slate-600">Owned</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900">${(featuredPlayer.stats.price / 1000).toFixed(0)}k</p>
          <p className="text-xs text-slate-600">Price</p>
        </div>
      </div>

      {/* Form Chart */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-medium text-slate-700">Recent Form</h5>
          <span className={`text-xs px-2 py-1 rounded-full ${
            getFormTrend() === 'excellent' ? 'bg-green-100 text-green-700' :
            getFormTrend() === 'good' ? 'bg-blue-100 text-blue-700' :
            'bg-yellow-100 text-yellow-700'
          }`}>
            {getFormTrend()}
          </span>
        </div>
        <div className="flex items-end space-x-1 h-12">
          {featuredPlayer.form.map((score, index) => (
            <motion.div
              key={index}
              initial={{ height: 0 }}
              animate={{ height: `${(score / Math.max(...featuredPlayer.form)) * 100}%` }}
              transition={{ delay: index * 0.1 }}
              className="flex-1 bg-blue-500 rounded-sm min-h-[4px]"
              title={`Round ${index + 1}: ${score} pts`}
            />
          ))}
        </div>
      </div>

      {/* Spotlight Text */}
      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-sm text-yellow-800">{featuredPlayer.spotlight}</p>
      </div>

      {/* Action */}
      <button className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium">
        View Player Profile →
      </button>
    </div>
  );
}
