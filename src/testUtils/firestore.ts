import type { Firestore } from 'firebase-admin/firestore';
import { vi } from 'vitest';

type FirestoreDocFactory = (id: string) => { id: string } | object;
type FirestoreBulkWriterFactory = Pick<Firestore, 'bulkWriter'>['bulkWriter'];

export function createFirestoreMock(options?: {
  bulkWriterFactory?: FirestoreBulkWriterFactory;
  docFactory?: FirestoreDocFactory;
}) {
  const set = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const doc = vi.fn((id: string) => options?.docFactory?.(id) ?? { id });
  const collection = vi.fn(() => ({ doc }));
  const defaultBulkWriterFactory = (() => ({
    set,
    close,
  })) as unknown as FirestoreBulkWriterFactory;
  const bulkWriter = vi.fn(options?.bulkWriterFactory ?? defaultBulkWriterFactory);

  return {
    firestore: {
      collection,
      bulkWriter,
    } as unknown as Pick<Firestore, 'collection' | 'bulkWriter'>,
    spies: {
      bulkWriter,
      close,
      collection,
      doc,
      set,
    },
  };
}
