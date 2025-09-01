// Fallback types for when Prisma client is not properly generated
// This file provides minimal type definitions to resolve compilation errors

export enum DraftStatus {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export enum DraftType {
  SNAKE = 'SNAKE',
  LINEAR = 'LINEAR'
}

export enum DraftDirection {
  FORWARD = 'FORWARD',
  REVERSE = 'REVERSE'
}

export enum LeagueRole {
  OWNER = 'OWNER',
  MEMBER = 'MEMBER',
  ADMIN = 'ADMIN'
}

export enum PickOrder {
  RANDOM = 'RANDOM',
  MANUAL = 'MANUAL'
}

export enum WaiverRule {
  WEEKLY = 'WEEKLY',
  ROLLING = 'ROLLING'
}

// Type for Prisma transaction
export type PrismaTransactionClient = any;

// Basic Prisma types
export interface PrismaClientKnownRequestError extends Error {
  code: string;
  meta?: any;
}

export const Prisma = {
  PrismaClientKnownRequestError: class extends Error implements PrismaClientKnownRequestError {
    code: string;
    meta?: any;
    constructor(message: string, code: string, meta?: any) {
      super(message);
      this.code = code;
      this.meta = meta;
    }
  },
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({
    strings,
    values
  })
};