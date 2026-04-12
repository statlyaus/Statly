import type { Prisma } from '@prisma/client';

export function createTransactionClientMock<T extends object>(shape: T): Prisma.TransactionClient {
  return shape as unknown as Prisma.TransactionClient;
}
