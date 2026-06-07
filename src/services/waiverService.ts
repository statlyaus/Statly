/**
 * Waiver Service
 * Comprehensive waiver claim and processing system with queue management
 */

// Types
export interface WaiverRequest {
  id: string;
  leagueId: string;
  userId: string;
  requestType: 'CLAIM' | 'DROP' | 'TRADE';
  targetPlayerId: string;
  dropPlayerId?: string;
  bidAmount?: number; // For FAAB systems
  priority: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  submittedAt: Date;
  processedAt?: Date;
  expiresAt?: Date;
  reason?: string;
  metadata: {
    originalPriority?: number;
    previousOwner?: string;
    claimReason?: string;
    automaticDrop?: boolean;
  };
}

export interface WaiverPriority {
  userId: string;
  currentPriority: number;
  seasonPriority: number;
  lastClaimDate?: Date;
  totalClaims: number;
  remainingFAAB?: number;
}

export interface WaiverProcessingResult {
  processed: WaiverRequest[];
  approved: WaiverRequest[];
  rejected: WaiverRequest[];
  priorityUpdates: WaiverPriority[];
  errors: Array<{
    requestId: string;
    error: string;
  }>;
}

export interface WaiverSystemConfig {
  system: 'ROLLING_LIST' | 'FAAB' | 'FREE_AGENCY';
  processTime: 'DAILY' | 'TWICE_WEEKLY' | 'WEEKLY' | 'CONTINUOUS';
  waiverPeriod: number; // hours
  claimSettings: {
    claimDeadline: string; // HH:MM format
    retroactiveClaims: boolean;
    blindBidding: boolean;
    minimumBid?: number;
    bidIncrement?: number;
  };
  dropSettings: {
    cantDropList: string[];
    minimumOwnershipTime: number; // hours
    dropDeadline?: string;
  };
  prioritySettings: {
    resetFrequency: 'NEVER' | 'WEEKLY' | 'MONTHLY' | 'SEASON';
    tiebreaker: 'RANDOM' | 'DRAFT_ORDER' | 'STANDINGS';
    movesToBack: boolean; // Move to back of priority after successful claim
  };
}

const WAIVER_PROJECTION_UNAVAILABLE_ERROR =
  'Waiver data is unavailable because league ownership projection has not loaded';

class WaiverService {
  async submitWaiverClaim(_params: {
    leagueId: string;
    userId: string;
    targetPlayerId: string;
    dropPlayerId?: string;
    bidAmount?: number;
    claimReason?: string;
  }): Promise<WaiverRequest> {
    return this.raiseProjectionUnavailable();
  }

  async processWaiverQueue(_leagueId: string): Promise<WaiverProcessingResult> {
    return this.raiseProjectionUnavailable();
  }

  async getPendingWaiverRequests(_leagueId: string): Promise<WaiverRequest[]> {
    return this.raiseProjectionUnavailable();
  }

  async getWaiverPriorities(_leagueId: string): Promise<WaiverPriority[]> {
    return this.raiseProjectionUnavailable();
  }

  async getUserWaiverPriority(_leagueId: string, _userId: string): Promise<WaiverPriority> {
    return this.raiseProjectionUnavailable();
  }

  async cancelWaiverRequest(
    _leagueId: string,
    _requestId: string,
    _userId: string
  ): Promise<void> {
    return this.raiseProjectionUnavailable();
  }

  async getUserWaiverHistory(
    _leagueId: string,
    _userId: string,
    _limit: number = 50
  ): Promise<WaiverRequest[]> {
    return this.raiseProjectionUnavailable();
  }

  private raiseProjectionUnavailable(): never {
    throw new Error(WAIVER_PROJECTION_UNAVAILABLE_ERROR);
  }
}

// Export singleton instance
export const waiverService = new WaiverService();

export default WaiverService;
