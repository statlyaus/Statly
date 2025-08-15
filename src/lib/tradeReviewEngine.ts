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

export interface TradeReviewLogEntry {
  timestamp: number;
  action: string;
  details?: unknown;
}

export class TradeReviewEngine {
  private state: TradeReviewEngineState;
  private options: TradeReviewEngineOptions;
  private auditLog: TradeReviewLogEntry[] = [];
  private notify: ((action: string, state: TradeReviewEngineState) => void) | null = null;

  constructor(options: TradeReviewEngineOptions, notify?: (action: string, state: TradeReviewEngineState) => void) {
    this.options = options;
    this.state = {
      status: 'offered',
      vetoCount: 0,
    };
    if (notify) this.notify = notify;
    this.logAction('init', { options });
  }

  private logAction(action: string, details?: unknown) {
    this.auditLog.push({ timestamp: Date.now(), action, details });
    if (this.notify) this.notify(action, this.state);
  }

  acceptTrade() {
    if (this.state.status !== 'offered') return;
    this.state.status = this.options.reviewWindowMs > 0 ? 'underReview' : 'processed';
    if (this.state.status === 'underReview') {
      this.state.reviewWindowExpiresAt = Date.now() + this.options.reviewWindowMs;
    }
    this.logAction('accept');
  }

  vetoTrade() {
    if (this.state.status !== 'underReview') return;
    this.state.vetoCount++;
    this.logAction('veto', { vetoCount: this.state.vetoCount });
    if (this.state.vetoCount >= this.options.vetoThreshold) {
      this.state.status = 'vetoed';
      this.logAction('vetoed');
    }
  }

  processTrade(teamPlayers: Player[]) {
    if (this.state.status !== 'underReview' && this.state.status !== 'accepted') return;
    if (!this.options.validateRoster(teamPlayers)) {
      this.state.invalidRoster = true;
      this.state.status = 'vetoed';
      this.logAction('invalidRoster', { teamPlayers });
      return;
    }
    this.state.status = 'processed';
    this.logAction('processed', { teamPlayers });
  }

  adminOverride(status: TradeStatus) {
    this.state.status = status;
    this.logAction('adminOverride', { status });
  }

  getState(): TradeReviewEngineState {
    return this.state;
  }

  getAuditLog(): TradeReviewLogEntry[] {
    return this.auditLog;
  }
}
