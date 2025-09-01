import type { FantasyCategoryKey } from './fantasyCategories';
import type { Timestamp } from 'firebase-admin/firestore';

// Core League Types
export type LeagueType = 'public' | 'private';
export type LeagueStatus = 'preseason' | 'active' | 'completed';
export type TradeReview = 'none' | 'admin' | 'veto';
export type WaiverResetPolicy = 'weekly' | 'rolling';
export type MemberRole = 'owner' | 'manager' | 'member';

// League Configuration Interfaces
export interface TradeSettings {
  tradeLimit: number; // Max trades per season per team
  tradeReview: TradeReview;
  tradeDeadline?: string; // ISO date string
}

export interface WaiverWireSettings {
  waiverOrder: string[]; // Array of team IDs in order
  waiverPeriodHours: number; // Hours before waivers process
  waiverResetPolicy: WaiverResetPolicy;
}

// Main League Interface
export interface League {
  id: string;
  name: string;
  code: string; // Unique 6-8 character join code
  type: LeagueType;
  ownerId: string; // User ID of creator/admin
  maxTeams: number;
  categories: FantasyCategoryKey[]; // Scoring categories
  tradeSettings: TradeSettings;
  waiverWire: WaiverWireSettings;
  createdAt: string; // ISO timestamp
  status: LeagueStatus;
  description?: string;
  draftDate?: string; // ISO timestamp
  currentTeams?: number; // Computed field for current member count
}

// Firestore document shape for league members (server-side)
export interface LeagueMemberDoc {
  id: string;
  leagueId: string;
  userId: string;
  role: MemberRole;
  teamName: string;
  joinedAt: Timestamp; // Firestore Timestamp
  leftAt?: Timestamp; // Firestore Timestamp
  isActive?: boolean;
}

// API/UI shape for league members (client-side), dates as ISO strings
export interface LeagueMember {
  id: string;
  leagueId: string;
  userId: string;
  role: MemberRole;
  teamName: string;
  joinedAt: string; // ISO timestamp
  leftAt?: string; // ISO timestamp
  isActive?: boolean;
}

// League Creation Input
export interface CreateLeagueRequest {
  name: string;
  type: LeagueType;
  maxTeams: number;
  categories: FantasyCategoryKey[];
  description?: string;
  tradeSettings?: Partial<TradeSettings>;
  waiverWire?: Partial<WaiverWireSettings>;
  draftDate?: string;
}

// League Join Request
export interface JoinLeagueRequest {
  code?: string; // For private leagues
  teamName: string;
}

// League summary returned after joining
export interface JoinedLeagueSummary {
  id: string;
  name: string;
  draftDate?: string;
}

// League Update Request (only editable fields)
export interface UpdateLeagueRequest {
  name?: string;
  description?: string;
  draftDate?: string;
  tradeSettings?: Partial<TradeSettings>;
  waiverWire?: Partial<WaiverWireSettings>;
}

// League with Members (for detailed views)
export interface LeagueWithMembers extends League {
  members: LeagueMember[];
  owner: LeagueMember;
}

// Public League Listing (minimal info for browsing)
export interface PublicLeagueListing {
  id: string;
  name: string;
  description?: string;
  maxTeams: number;
  currentTeams: number;
  categories: FantasyCategoryKey[];
  draftDate?: string;
  createdAt: string;
}

// League Dashboard Data
export interface LeagueDashboard extends LeagueWithMembers {
  canEdit: boolean; // If current user can edit settings
  canJoin: boolean; // If current user can join
  isOwner: boolean; // If current user is owner
  userMembership?: LeagueMember; // Current user's membership if they're in league
}

// Trade Interface
export interface Trade {
  id: string;
  leagueId: string;
  fromTeamId: string;
  toTeamId: string;
  fromPlayers: string[]; // Player IDs
  toPlayers: string[]; // Player IDs
  status: 'pending' | 'approved' | 'rejected' | 'vetoed';
  proposedAt: string;
  reviewedAt?: string;
  reviewedBy?: string; // User ID
  notes?: string;
}

// Waiver Claim Interface
export interface WaiverClaim {
  id: string;
  leagueId: string;
  teamId: string;
  playerId: string; // Player to claim
  dropPlayerId?: string; // Player to drop (if roster full)
  priority: number; // Waiver order position when submitted
  status: 'pending' | 'processed' | 'failed';
  submittedAt: string;
  processedAt?: string;
  reason?: string; // Failure reason if status is 'failed'
}

// Draft Interface (basic structure)
export interface Draft {
  id: string;
  leagueId: string;
  type: 'snake' | 'linear';
  rounds: number;
  currentRound: number;
  currentPick: number;
  pickOrder: string[]; // Team IDs in draft order
  status: 'scheduled' | 'active' | 'completed';
  startedAt?: string;
  completedAt?: string;
}

// Draft Pick Interface
export interface DraftPick {
  id: string;
  draftId: string;
  teamId: string;
  playerId?: string; // null if pick not made yet
  round: number;
  pickNumber: number; // Overall pick number
  pickedAt?: string;
  timeLimit?: number; // Seconds allowed for pick
}

// Validation Schemas
export const LEAGUE_CONSTRAINTS = {
  name: {
    minLength: 3,
    maxLength: 50,
  },
  code: {
    length: 8, // Always 8 characters
    pattern: /^[A-Z0-9]{8}$/, // Uppercase letters and numbers only
  },
  maxTeams: {
    min: 4,
    max: 20,
  },
  categories: {
    min: 3,
    max: 10,
  },
  teamName: {
    minLength: 3,
    maxLength: 30,
  },
  description: {
    maxLength: 500,
  },
} as const;

// Default Settings
export const DEFAULT_TRADE_SETTINGS: TradeSettings = {
  tradeLimit: 10,
  tradeReview: 'none',
};

export const DEFAULT_WAIVER_SETTINGS: Partial<WaiverWireSettings> = {
  waiverPeriodHours: 24,
  waiverResetPolicy: 'weekly',
  waiverOrder: [], // Will be populated when teams join
};

// Helper Types
export type LeaguePermission = 'view' | 'edit' | 'manage_members' | 'admin';

export interface UserPermissions {
  [leagueId: string]: LeaguePermission[];
}

// Error Types
export class LeagueError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'LeagueError';
  }
}

export const LEAGUE_ERROR_CODES = {
  LEAGUE_NOT_FOUND: 'LEAGUE_NOT_FOUND',
  LEAGUE_FULL: 'LEAGUE_FULL',
  INVALID_CODE: 'INVALID_CODE',
  ALREADY_JOINED: 'ALREADY_JOINED',
  DRAFT_STARTED: 'DRAFT_STARTED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  INVALID_SETTINGS: 'INVALID_SETTINGS',
} as const;
