import type { Player } from '@/types/players';

export type TradeStatus = 'offered' | 'accepted' | 'underReview' | 'processed' | 'vetoed';

export interface TradeReviewEngineOptions {
  vetoThreshold: number;
  reviewWindowMs: number;
  validateRoster: (teamPlayers: Player[]) => boolean;
}

export interface TradeReviewEngineState {
  status: TradeStatus;
  vetoCount: number;
  reviewWindowExpiresAt?: number;
  invalidRoster?: boolean;
}

export class TradeReviewEngine {
  private state: TradeReviewEngineState;
  private options: TradeReviewEngineOptions;

  constructor(options: TradeReviewEngineOptions) {
    this.options = options;
    this.state = {
      status: 'offered',
      vetoCount: 0,
    };
  }

  acceptTrade() {
    if (this.state.status !== 'offered') return;
    this.state.status = this.options.reviewWindowMs > 0 ? 'underReview' : 'processed';
    if (this.state.status === 'underReview') {
      this.state.reviewWindowExpiresAt = Date.now() + this.options.reviewWindowMs;
    }
  }

  vetoTrade() {
    if (this.state.status !== 'underReview') return;
    this.state.vetoCount++;
    if (this.state.vetoCount >= this.options.vetoThreshold) {
      this.state.status = 'vetoed';
    }
  }

  processTrade(teamPlayers: Player[]) {
    if (this.state.status !== 'underReview' && this.state.status !== 'accepted') return;
    if (!this.options.validateRoster(teamPlayers)) {
      this.state.invalidRoster = true;
      this.state.status = 'vetoed';
      return;
    }
    this.state.status = 'processed';
  }

  getState(): TradeReviewEngineState {
    return this.state;
  }
}
