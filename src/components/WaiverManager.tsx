/**
 * Waiver Management Component
 * Complete interface for waiver claims, queue management, and priority tracking
 */

'use client';

import React, { useState, useMemo } from 'react';
import type { JSX } from 'react';

import { useWaivers } from '@/hooks/useWaivers';
import type { WaiverRequest, WaiverPriority } from '@/services/waiverService';

interface WaiverManagerProps {
  leagueId: string;
  userId: string;
  isCommissioner?: boolean;
  systemType: 'ROLLING_LIST' | 'FAAB' | 'FREE_AGENCY';
}

interface WaiverClaimFormProps {
  onSubmit: (params: {
    targetPlayerId: string;
    dropPlayerId?: string;
    bidAmount?: number;
    claimReason?: string;
  }) => Promise<void>;
  submitting: boolean;
  userPriority: WaiverPriority | null;
  systemType: 'ROLLING_LIST' | 'FAAB' | 'FREE_AGENCY';
}

interface WaiverQueueProps {
  requests: WaiverRequest[];
  userPriority: WaiverPriority | null;
  onCancel: (requestId: string) => void | Promise<void>;
  userId: string;
}

interface WaiverHistoryProps {
  requests: WaiverRequest[];
  userId: string;
}

export function WaiverManager({
  leagueId,
  userId,
  isCommissioner = false,
  systemType,
}: WaiverManagerProps): JSX.Element {
  const {
    waiverRequests,
    userPriority,
    loading,
    submitting,
    processing,
    error,
    submitClaim,
    cancelRequest,
    processQueue,
    refreshData,
    pendingRequests,
    userRequests,
    canSubmitClaim,
  } = useWaivers({ leagueId, userId, autoRefresh: true });

  const [activeTab, setActiveTab] = useState<'queue' | 'claim' | 'history' | 'admin'>('queue');
  const [showClaimForm, setShowClaimForm] = useState(false);

  const handleSubmitClaim = async (params: {
    targetPlayerId: string;
    dropPlayerId?: string;
    bidAmount?: number;
    claimReason?: string;
  }) => {
    try {
      await submitClaim(params);
      setShowClaimForm(false);
    } catch (err) {
      console.error('Failed to submit claim:', err);
    }
  };

  const handleProcessQueue = async () => {
    try {
      await processQueue();
    } catch (err) {
      console.error('Failed to process queue:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading waivers...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error Loading Waivers</h3>
        <p className="text-red-600 text-sm mt-1">{error}</p>
        <button
          onClick={refreshData}
          className="mt-3 text-red-600 hover:text-red-800 text-sm font-medium"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Waiver Management</h1>
            <p className="text-gray-600">
              Current Priority: {userPriority?.currentPriority || 'N/A'} |
              {systemType === 'FAAB' && ` FAAB Remaining: $${userPriority?.remainingFAAB || 0}`}
            </p>
          </div>
          <div className="space-x-3">
            <button
              onClick={() => setShowClaimForm(true)}
              disabled={!canSubmitClaim}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Submit Claim
            </button>
            <button
              onClick={refreshData}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300"
            >
              Refresh
            </button>
            {isCommissioner && (
              <button
                onClick={handleProcessQueue}
                disabled={processing}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Process Queue'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'queue', label: 'Waiver Queue', count: pendingRequests.length },
            { id: 'claim', label: 'Submit Claim', count: null },
            { id: 'history', label: 'My Claims', count: userRequests.length },
            ...(isCommissioner ? [{ id: 'admin', label: 'Admin', count: null }] : []),
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              {tab.count !== null && (
                <span className="ml-2 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="space-y-6">
        {activeTab === 'queue' && (
          <WaiverQueue
            requests={pendingRequests}
            userPriority={userPriority}
            onCancel={cancelRequest}
            userId={userId}
          />
        )}

        {activeTab === 'claim' && (
          <WaiverClaimForm
            onSubmit={handleSubmitClaim}
            submitting={submitting}
            userPriority={userPriority}
            systemType={systemType}
          />
        )}

        {activeTab === 'history' && <WaiverHistory requests={userRequests} userId={userId} />}

        {activeTab === 'admin' && isCommissioner && (
          <WaiverAdmin
            requests={waiverRequests}
            onProcessQueue={handleProcessQueue}
            processing={processing}
          />
        )}
      </div>

      {/* Claim Form Modal */}
      {showClaimForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">Submit Waiver Claim</h3>
              <button
                onClick={() => setShowClaimForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <WaiverClaimForm
              onSubmit={handleSubmitClaim}
              submitting={submitting}
              userPriority={userPriority}
              systemType={systemType}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-components

function WaiverQueue({
  requests,
  userPriority: _userPriority,
  onCancel,
  userId,
}: WaiverQueueProps) {
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

  const handleCancel = async (request: WaiverRequest) => {
    const idKey = String(request.targetPlayerId);
    if (cancellingIds.has(idKey)) return;
    setCancellingIds((prev) => {
      const next = new Set(prev);
      next.add(idKey);
      return next;
    });
    try {
      await Promise.resolve(onCancel(request.id));
    } catch (err) {
      console.error('Failed to cancel waiver request:', err);
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(idKey);
        return next;
      });
    }
  };

  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      // Sort by priority, then by submission time
      const priorityDiff = a.priority - b.priority;
      if (priorityDiff !== 0) return priorityDiff;
      return a.submittedAt.getTime() - b.submittedAt.getTime();
    });
  }, [requests]);

  if (requests.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Waiver Queue</h2>
        <p className="text-gray-500">No pending waiver requests.</p>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Waiver Queue</h2>

      <ol
        className="space-y-3 list-none"
        aria-label="Waiver queue ordered by priority then submission time"
      >
        {sortedRequests.map((request, index) => {
          const isCancelling = cancellingIds.has(String(request.targetPlayerId));
          return (
            <li
              key={request.id}
              className={`border rounded-lg p-4 ${
                request.userId === userId ? 'border-blue-200 bg-blue-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <span
                      className="bg-gray-100 text-gray-800 text-xs font-medium px-2 py-1 rounded"
                      aria-hidden="true"
                    >
                      #{index + 1}
                    </span>
                    <span className="font-medium">Claim Player #{request.targetPlayerId}</span>
                    {request.dropPlayerId && (
                      <span className="text-gray-600 text-sm">→ Drop #{request.dropPlayerId}</span>
                    )}
                  </div>

                  <div className="mt-2 text-sm text-gray-600">
                    <span>Priority: {request.priority}</span>
                    {request.bidAmount != null && (
                      <span className="ml-4">Bid: ${request.bidAmount}</span>
                    )}
                    <span className="ml-4">
                      Submitted: {new Date(request.submittedAt).toLocaleString()}
                    </span>
                    {request.expiresAt && (
                      <span className="ml-4">
                        Expires: {new Date(request.expiresAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {request.userId === userId && (
                  <button
                    onClick={() => handleCancel(request)}
                    type="button"
                    className="text-red-600 hover:text-red-800 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={`Cancel waiver claim for player ${request.targetPlayerId}`}
                    disabled={isCancelling}
                    aria-disabled={isCancelling}
                    aria-busy={isCancelling}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function WaiverClaimForm({ onSubmit, submitting, userPriority, systemType }: WaiverClaimFormProps) {
  const [targetPlayerId, setTargetPlayerId] = useState('');
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [bidAmount, setBidAmount] = useState<number | ''>('');
  const [claimReason, setClaimReason] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPlayerId) return;

    type SubmitParams = Parameters<typeof onSubmit>[0];
    const payload: SubmitParams = { targetPlayerId } as SubmitParams;

    if (dropPlayerId) {
      payload.dropPlayerId = dropPlayerId;
    }
    if (systemType === 'FAAB' && typeof bidAmount === 'number') {
      payload.bidAmount = bidAmount;
    }
    if (claimReason) {
      payload.claimReason = claimReason;
    }

    await onSubmit(payload);

    // Reset form
    setTargetPlayerId('');
    setDropPlayerId('');
    setBidAmount('');
    setClaimReason('');
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Submit Waiver Claim</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="targetPlayer" className="block text-sm font-medium text-gray-700">
            Target Player ID
          </label>
          <input
            id="targetPlayer"
            type="text"
            value={targetPlayerId}
            onChange={(e) => setTargetPlayerId(e.target.value)}
            required
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter player ID to claim"
          />
        </div>

        <div>
          <label htmlFor="dropPlayer" className="block text-sm font-medium text-gray-700">
            Drop Player ID (optional)
          </label>
          <input
            id="dropPlayer"
            type="text"
            value={dropPlayerId}
            onChange={(e) => setDropPlayerId(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter player ID to drop"
          />
        </div>

        {systemType === 'FAAB' && (
          <div>
            <label htmlFor="bidAmount" className="block text-sm font-medium text-gray-700">
              Bid Amount (${userPriority?.remainingFAAB || 0} remaining)
            </label>
            <input
              id="bidAmount"
              type="number"
              min="0"
              max={userPriority?.remainingFAAB || 0}
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value ? Number(e.target.value) : '')}
              required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}

        <div>
          <label htmlFor="claimReason" className="block text-sm font-medium text-gray-700">
            Reason (optional)
          </label>
          <textarea
            id="claimReason"
            value={claimReason}
            onChange={(e) => setClaimReason(e.target.value)}
            rows={3}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="Why do you want this player?"
          />
        </div>

        <div className="bg-gray-50 rounded-md p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Your Waiver Info</h4>
          <div className="text-sm text-gray-600">
            <p>Current Priority: {userPriority?.currentPriority || 'N/A'}</p>
            <p>Total Claims This Season: {userPriority?.totalClaims || 0}</p>
            {systemType === 'FAAB' && <p>FAAB Remaining: ${userPriority?.remainingFAAB || 0}</p>}
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || !targetPlayerId}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit Waiver Claim'}
        </button>
      </form>
    </div>
  );
}

function WaiverHistory({ requests }: WaiverHistoryProps) {
  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  }, [requests]);

  if (requests.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">My Waiver Claims</h2>
        <p className="text-gray-500">No waiver claims submitted yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">My Waiver Claims</h2>

      <div className="space-y-3">
        {sortedRequests.map((request) => (
          <div key={request.id} className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-3">
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${
                      request.status === 'APPROVED'
                        ? 'bg-green-100 text-green-800'
                        : request.status === 'REJECTED'
                          ? 'bg-red-100 text-red-800'
                          : request.status === 'EXPIRED'
                            ? 'bg-gray-100 text-gray-800'
                            : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {request.status}
                  </span>
                  <span className="font-medium">Claim Player #{request.targetPlayerId}</span>
                  {request.dropPlayerId && (
                    <span className="text-gray-600 text-sm">→ Drop #{request.dropPlayerId}</span>
                  )}
                </div>

                <div className="mt-2 text-sm text-gray-600">
                  <span>Priority: {request.priority}</span>
                  {request.bidAmount != null && (
                    <span className="ml-4">Bid: ${request.bidAmount}</span>
                  )}
                  <span className="ml-4">
                    Submitted: {new Date(request.submittedAt).toLocaleString()}
                  </span>
                  {request.processedAt && (
                    <span className="ml-4">
                      Processed: {new Date(request.processedAt).toLocaleString()}
                    </span>
                  )}
                </div>

                {request.reason && (
                  <div className="mt-2 text-sm text-gray-600">Reason: {request.reason}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WaiverAdmin({
  requests,
  onProcessQueue,
  processing,
}: {
  requests: WaiverRequest[];
  onProcessQueue: () => void;
  processing: boolean;
}) {
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const processedToday = requests.filter(
    (r) => r.processedAt && new Date(r.processedAt).toDateString() === new Date().toDateString()
  ).length;

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Commissioner Tools</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-600">{pendingCount}</div>
            <div className="text-sm text-blue-800">Pending Claims</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-600">{processedToday}</div>
            <div className="text-sm text-green-800">Processed Today</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-600">{requests.length}</div>
            <div className="text-sm text-purple-800">Total Requests</div>
          </div>
        </div>

        <button
          onClick={onProcessQueue}
          disabled={processing || pendingCount === 0}
          className="bg-green-600 text-white px-6 py-3 rounded-md hover:bg-green-700 disabled:opacity-50 font-medium"
        >
          {processing ? 'Processing Queue...' : `Process ${pendingCount} Pending Claims`}
        </button>
      </div>
    </div>
  );
}

export default WaiverManager;
