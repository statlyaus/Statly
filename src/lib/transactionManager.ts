import type { PrismaClient } from '@prisma/client';
import { DraftStatus, Prisma } from '@/types/prisma-fallback';
import { logger } from '@/lib/logger';

// Use Prisma.TransactionClient for transaction callbacks

export interface TransactionOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface TransactionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  retryCount: number;
  duration: number;
}

/**
 * Enhanced transaction wrapper with retry logic and safety features
 */
export class TransactionManager {
  private prisma: PrismaClient;
  private defaultOptions: Required<TransactionOptions>;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
    this.defaultOptions = {
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 30000
    };
  }

  /**
   * Execute a function within a database transaction with retry logic
   */
  async executeTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options: TransactionOptions = {}
  ): Promise<TransactionResult<T>> {
    const config = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= config.maxRetries) {
      try {
        const result = await this.prisma.$transaction(
          async (tx: Prisma.TransactionClient) => {
            return await operation(tx);
          },
          {
            timeout: config.timeout
          }
        );

        const duration = Date.now() - startTime;
        
        logger.info('Transaction completed successfully', {
          retryCount,
          duration
        });

        return {
          success: true,
          data: result,
          retryCount,
          duration
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retryCount++;

        logger.warn('Transaction failed', {
          attempt: retryCount,
          maxRetries: config.maxRetries,
          error: lastError.message,
          willRetry: retryCount <= config.maxRetries
        });

        // Check if error is retryable
        if (!this.isRetryableError(lastError) || retryCount > config.maxRetries) {
          break;
        }

        // Wait before retry with exponential backoff
        const delay = config.retryDelay * Math.pow(2, retryCount - 1);
        await this.sleep(delay);
      }
    }

    const duration = Date.now() - startTime;
    
    logger.error('Transaction failed after all retries', {
      retryCount: retryCount - 1,
      duration,
      finalError: lastError?.message
    });

    return {
      success: false,
      error: lastError?.message || 'Unknown transaction error',
      retryCount: retryCount - 1,
      duration
    };
  }

  /**
   * Execute multiple operations in a single transaction
   */
  async batchTransaction<T>(
    operations: Array<(tx: Prisma.TransactionClient) => Promise<T>>,
    options: TransactionOptions = {}
  ): Promise<TransactionResult<T[]>> {
    return this.executeTransaction(async (tx) => {
      const results: T[] = [];
      
      for (const operation of operations) {
        const result = await operation(tx);
        results.push(result);
      }
      
      return results;
    }, options);
  }

  /**
   * Check if an error is worth retrying
   */
  private isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      /deadlock/i,
      /lock timeout/i,
      /connection/i,
      /timeout/i,
      /temporary/i,
      /serialization failure/i,
      /concurrent update/i
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Common transaction patterns for draft operations
export const draftTransactionPatterns = {
  /**
   * Update draft state with validation
   */
  updateDraftState: async (
    tx: Prisma.TransactionClient,
    draftId: string,
    newStatus: DraftStatus,
    additionalData: Record<string, unknown> = {}
  ) => {
    // Validate current state
    const currentDraft = await tx.draft.findUnique({
      where: { id: draftId },
      select: { status: true, leagueId: true }
    });

    if (!currentDraft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    // Update draft with validation
    return await tx.draft.update({
      where: { id: draftId },
      data: {
        status: newStatus,
        ...additionalData
      }
    });
  },
  /**
   * Atomically claim the next pick using a schedulingVersion counter.
   * Requires a `schedulingVersion` int column on Draft model in the database.
   * Returns { claimed: boolean, draftId?, nextPickNumber?, newVersion? }
   */
  claimNextPick: async (
    tx: Prisma.TransactionClient,
    leagueId: string
  ): Promise<{ claimed: boolean; draftId?: string; nextPickNumber?: number; newVersion?: number }> => {
    // Read current draft state using a raw query to avoid depending on Prisma client types
    const draftRows = await tx.$queryRaw<Array<{ id: string; currentPick: number; totalPicks: number; schedulingVersion: number }>>`
      SELECT id, currentPick, totalPicks, schedulingVersion
      FROM Draft
      WHERE leagueId = ${leagueId} AND status = 'LIVE'
      LIMIT 1
    `;

    const draft = draftRows && draftRows.length > 0 ? draftRows[0] : null;
    if (!draft) return { claimed: false };
    if (draft.currentPick >= draft.totalPicks) return { claimed: false };

    const currentVersion = draft.schedulingVersion as number;
    const nextVersion = currentVersion + 1;
    const nextPickNumber = draft.currentPick + 1;

    // Conditional atomic update using raw SQL: only succeed if schedulingVersion still equals currentVersion and currentPick unchanged
    const updateSql = Prisma.sql`UPDATE "Draft" SET "schedulingVersion" = ${nextVersion} WHERE "id" = ${draft.id} AND "currentPick" = ${draft.currentPick} AND "schedulingVersion" = ${currentVersion}`;
    // Execute the parameterized SQL and get affected row count. Use generic to ensure proper typing without `any`.
    const updateResult = await tx.$executeRaw<number>(updateSql);
    const affected: number = updateResult;

    if (affected === 1) {
      return { claimed: true, draftId: draft.id, nextPickNumber, newVersion: nextVersion };
    }

    return { claimed: false };
  }
};

// Singleton instance for easy access
let transactionManager: TransactionManager | null = null;

export function getTransactionManager(prismaClient: PrismaClient): TransactionManager {
  if (!transactionManager) {
    transactionManager = new TransactionManager(prismaClient);
  }
  return transactionManager;
}

export default TransactionManager;
