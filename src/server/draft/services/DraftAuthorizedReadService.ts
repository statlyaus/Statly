import type { DraftClockScheduleReceipt } from '../domain/draftTypes';
import { getDraftMembershipAccess } from '@/server/leagues/membership';

import { draftClockCoordinator } from './DraftClockCoordinator';
import { draftProjectionService } from './DraftProjectionService';
import type { DraftRoomSnapshotPayload } from '@/services/realtime/draftStateWire';

const MAX_READY_READ_ATTEMPTS = 3;

export class DraftReadAccessError extends Error {
  readonly code = 'FORBIDDEN';

  constructor() {
    super('Not a member of this draft');
    this.name = 'DraftReadAccessError';
  }
}

type ReadClockIdentity = {
  status: string;
  stateRevision: number;
};

/**
 * Authenticated self-healing read boundary. Authorization always precedes the only operation that
 * may repair/schedule a LIVE clock, and returned LIVE data must match the accepted job revision.
 */
export class DraftAuthorizedReadService {
  async authorizeMember(draftId: string, authenticatedUserId: string): Promise<void> {
    const access = await getDraftMembershipAccess(draftId, authenticatedUserId);
    if (!access.isMember) {
      throw new DraftReadAccessError();
    }
  }

  async readReadyForMember<T>(input: {
    draftId: string;
    authenticatedUserId: string;
    load: (expectedStateRevision?: number) => Promise<T | null>;
    getClockIdentity: (value: T) => ReadClockIdentity;
  }): Promise<T | null> {
    await this.authorizeMember(input.draftId, input.authenticatedUserId);

    for (let attempt = 1; attempt <= MAX_READY_READ_ATTEMPTS; attempt += 1) {
      const ready = await draftClockCoordinator.ensureReady(input.draftId);
      const receipt: DraftClockScheduleReceipt | null = ready.receipt;
      const value = await input.load(receipt?.token.stateRevision);

      if (!value) {
        if (receipt) continue;
        return null;
      }

      const identity = input.getClockIdentity(value);
      if (identity.status !== 'LIVE') {
        return value;
      }
      if (receipt && identity.stateRevision === receipt.token.stateRevision) {
        return value;
      }
    }

    throw new Error(
      `Draft changed during ${MAX_READY_READ_ATTEMPTS} authorized read attempts: ${input.draftId}`
    );
  }

  async buildRoomSnapshot(
    draftId: string,
    authenticatedUserId: string
  ): Promise<DraftRoomSnapshotPayload | null> {
    return this.readReadyForMember({
      draftId,
      authenticatedUserId,
      load: (expectedStateRevision) =>
        draftProjectionService.buildRoomSnapshot(
          draftId,
          authenticatedUserId,
          expectedStateRevision
        ),
      getClockIdentity: (snapshot) => ({
        status: snapshot.state.status,
        stateRevision: snapshot.revision,
      }),
    });
  }
}

export const draftAuthorizedReadService = new DraftAuthorizedReadService();
