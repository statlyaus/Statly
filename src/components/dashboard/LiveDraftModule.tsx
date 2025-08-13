import Link from 'next/link';
import { motion } from 'framer-motion';

interface LiveDraftModuleProps {
  refreshTrigger: number;
}

export default function LiveDraftModule({ refreshTrigger }: LiveDraftModuleProps) {
  // Mock draft status - in real app, fetch from API
  const draftStatus = {
    isLive: true,
    currentPick: 15,
    totalPicks: 180,
    yourTurn: false,
    nextTurn: 3,
    timeRemaining: 87,
  };

  return (
    <div className="space-y-4">
      {draftStatus.isLive ? (
        <>
          {/* Live Indicator */}
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-red-600">DRAFT LIVE</span>
          </div>

          {/* Draft Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Pick Progress</span>
              <span className="font-medium">{draftStatus.currentPick}/{draftStatus.totalPicks}</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <motion.div 
                className="bg-blue-600 h-2 rounded-full" 
                initial={{ width: 0 }}
                animate={{ width: `${(draftStatus.currentPick / draftStatus.totalPicks) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>

          {/* Turn Status */}
          {draftStatus.yourTurn ? (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium text-green-800">Your Turn!</span>
              </div>
              <p className="text-sm text-green-700 mt-1">Time remaining: {draftStatus.timeRemaining}s</p>
            </div>
          ) : (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <span className="font-medium">{draftStatus.nextTurn} picks</span> until your turn
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2">
            <Link 
              href="/drafts"
              className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors text-center"
            >
              Join Draft
            </Link>
            <button className="px-3 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors">
              Watch Only
            </button>
          </div>
        </>
      ) : (
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h4 className="font-medium text-slate-900 mb-1">No Active Draft</h4>
          <p className="text-sm text-slate-600 mb-3">Create or join a draft to get started</p>
          <Link 
            href="/drafts/create"
            className="inline-flex items-center px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Draft
          </Link>
        </div>
      )}
    </div>
  );
}
