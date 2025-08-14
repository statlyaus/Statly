import React from 'react';
import { 
  ClockIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import Link from 'next/link';

interface WaiversModuleProps {
  refreshTrigger: number;
}

export default function WaiversModule({ refreshTrigger: _refreshTrigger }: WaiversModuleProps) {
  // Mock waiver data
  const waiverData = {
    fAABBalance: 75,
    pendingClaims: 2,
    nextProcessing: new Date('2025-08-15T09:00:00'),
    recentClaims: [
      {
        playerName: 'Tom Mitchell',
        status: 'pending',
        bidAmount: 25,
        timeLeft: '2h 15m'
      },
      {
        playerName: 'Bailey Smith',
        status: 'outbid',
        bidAmount: 15,
        timeLeft: 'Processed'
      }
    ]
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <ClockIcon className="w-4 h-4 text-yellow-500" />;
      case 'successful':
        return <CheckCircleIcon className="w-4 h-4 text-green-500" />;
      case 'outbid':
        return <ExclamationTriangleIcon className="w-4 h-4 text-orange-500" />;
      default:
        return <ClockIcon className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'successful': return 'bg-green-100 text-green-800';
      case 'outbid': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const timeUntilProcessing = () => {
    const now = new Date();
    const diff = waiverData.nextProcessing.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="space-y-4">
      {/* FAAB Balance */}
      <div className="bg-green-50 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-green-600 uppercase tracking-wide">FAAB Balance</p>
            <p className="text-lg font-bold text-green-900">${waiverData.fAABBalance}</p>
          </div>
          <CurrencyDollarIcon className="w-6 h-6 text-green-600" />
        </div>
        <div className="mt-1">
          <span className="text-xs text-green-700">
            Next processing: {timeUntilProcessing()}
          </span>
        </div>
      </div>

      {/* Active Claims */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-900">Active Claims</h4>
          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
            {waiverData.pendingClaims}
          </span>
        </div>

        {waiverData.recentClaims.length === 0 ? (
          <div className="text-center py-4">
            <ClockIcon className="w-8 h-8 mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No active claims</p>
          </div>
        ) : (
          <div className="space-y-2">
            {waiverData.recentClaims.map((claim, index) => (
              <div key={index} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(claim.status)}
                    <span className="text-sm font-medium text-gray-900">
                      {claim.playerName}
                    </span>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(claim.status)}`}>
                    {claim.status}
                  </span>
                </div>
                
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>Bid: ${claim.bidAmount}</span>
                  <span>{claim.timeLeft}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/waivers"
          className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors text-center"
        >
          View All
        </Link>
        <Link
          href="/waivers/submit"
          className="bg-slate-100 text-slate-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors text-center"
        >
          + Submit Claim
        </Link>
      </div>
    </div>
  );
}
