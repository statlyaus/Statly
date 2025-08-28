import type { Timestamp as ClientTimestamp } from 'firebase/firestore';
import type { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';

/**
 * Shared Firebase timestamp type that can handle both client-side and server-side timestamps
 */
export type FirebaseTimestamp = ClientTimestamp | AdminTimestamp | Date;
