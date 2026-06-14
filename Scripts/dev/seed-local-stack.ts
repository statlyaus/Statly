#!/usr/bin/env tsx

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GOOGLE_CLOUD_PROJECT ??= 'statly-4cbed';
process.env.GCLOUD_PROJECT ??= process.env.GOOGLE_CLOUD_PROJECT;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= process.env.GOOGLE_CLOUD_PROJECT;

const LEGACY_LOCAL_DEVELOPMENT_USER_IDS = ['2qlfdHSCFTPlxoKFSUfNLSlCDRe2'];

function hasStoredJsonArray(value: string | null | undefined): boolean {
  if (!value) return false;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  const { adminAuth, adminDb } = await import('../../src/lib/firebaseAdmin');
  const { prisma } = await import('../../src/lib/prisma');
  const {
    DEVELOPMENT_AUTH_DISPLAY_NAME,
    DEVELOPMENT_AUTH_EMAIL,
    DEVELOPMENT_AUTH_USER_ID,
    resolveLocalDevelopmentAuthPhrase,
  } = await import('../../src/lib/devAuth');
  const {
    DEFAULT_DRAFT_AUTO_PICK_RULES,
    LOCAL_TEST_DRAFT_POSITION_LIMITS,
    getBenchSizeFromPositionLimits,
    getRosterSizeFromPositionLimits,
  } = await import('../../src/lib/draftSettings');
  const { REAL_DATA_NINE_CATEGORY_PRESET } = await import('../../src/types/fantasyCategories');
  const localAuthPhrase = resolveLocalDevelopmentAuthPhrase();

  try {
    await adminAuth.getUser(DEVELOPMENT_AUTH_USER_ID);
    await adminAuth.updateUser(DEVELOPMENT_AUTH_USER_ID, {
      email: DEVELOPMENT_AUTH_EMAIL,
      password: localAuthPhrase,
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      emailVerified: true,
      disabled: false,
    });
    console.log(`[local-seed] Updated Auth emulator user ${DEVELOPMENT_AUTH_USER_ID}`);
  } catch {
    await adminAuth.createUser({
      uid: DEVELOPMENT_AUTH_USER_ID,
      email: DEVELOPMENT_AUTH_EMAIL,
      password: localAuthPhrase,
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      emailVerified: true,
      disabled: false,
    });
    console.log(`[local-seed] Created Auth emulator user ${DEVELOPMENT_AUTH_USER_ID}`);
  }

  await prisma.user.upsert({
    where: { id: DEVELOPMENT_AUTH_USER_ID },
    update: {
      email: DEVELOPMENT_AUTH_EMAIL,
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      timeZone: 'Australia/Melbourne',
    },
    create: {
      id: DEVELOPMENT_AUTH_USER_ID,
      email: DEVELOPMENT_AUTH_EMAIL,
      passwordHash: 'local_emulator_user',
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      timeZone: 'Australia/Melbourne',
    },
  });
  console.log(`[local-seed] Upserted Prisma user ${DEVELOPMENT_AUTH_USER_ID}`);

  const [leagueOwnerRepair, memberRepair] = await prisma.$transaction([
    prisma.league.updateMany({
      where: {
        ownerId: { in: LEGACY_LOCAL_DEVELOPMENT_USER_IDS },
      },
      data: {
        ownerId: DEVELOPMENT_AUTH_USER_ID,
      },
    }),
    prisma.leagueMember.updateMany({
      where: {
        userId: { in: LEGACY_LOCAL_DEVELOPMENT_USER_IDS },
      },
      data: {
        userId: DEVELOPMENT_AUTH_USER_ID,
      },
    }),
  ]);

  if (leagueOwnerRepair.count > 0 || memberRepair.count > 0) {
    console.log(
      `[local-seed] Repaired ${leagueOwnerRepair.count} legacy league owner records and ${memberRepair.count} legacy league member records`
    );
  }

  const localDevelopmentUserIds = [
    DEVELOPMENT_AUTH_USER_ID,
    ...LEGACY_LOCAL_DEVELOPMENT_USER_IDS,
  ];
  const categoriesJson = JSON.stringify([...REAL_DATA_NINE_CATEGORY_PRESET]);
  const positionLimitsJson = JSON.stringify(LOCAL_TEST_DRAFT_POSITION_LIMITS);
  const autoPickRulesJson = JSON.stringify(DEFAULT_DRAFT_AUTO_PICK_RULES);
  const rosterSize = getRosterSizeFromPositionLimits(LOCAL_TEST_DRAFT_POSITION_LIMITS);
  const benchSize = getBenchSizeFromPositionLimits(LOCAL_TEST_DRAFT_POSITION_LIMITS);
  const repairedPickExpiryJobs: Array<{
    draftId: string;
    leagueId: string;
    schedulingVersion: number;
    pickDeadlineAt: Date;
  }> = [];
  const runtimeRepair = await prisma.$transaction(async (tx) => {
    const localLeagues = await tx.league.findMany({
      where: {
        OR: [
          { ownerId: { in: localDevelopmentUserIds } },
          { members: { some: { userId: { in: localDevelopmentUserIds } } } },
        ],
      },
      select: {
        id: true,
        categoriesJson: true,
        settings: {
          select: {
            id: true,
            pickSeconds: true,
            rosterSize: true,
            benchSize: true,
            positionLimitsJson: true,
            autoPickRulesJson: true,
          },
        },
        drafts: {
          where: { status: 'LIVE' },
          select: {
            id: true,
            pickStartedAt: true,
            pickDeadlineAt: true,
          },
        },
      },
    });
    let categoryCount = 0;
    let settingsCount = 0;
    let deadlineCount = 0;
    const now = new Date();

    for (const league of localLeagues) {
      if (!hasStoredJsonArray(league.categoriesJson)) {
        await tx.league.update({
          where: { id: league.id },
          data: { categoriesJson },
        });
        categoryCount += 1;
      }

      if (
        league.settings.rosterSize !== rosterSize ||
        league.settings.benchSize !== benchSize ||
        league.settings.positionLimitsJson !== positionLimitsJson ||
        league.settings.autoPickRulesJson !== autoPickRulesJson
      ) {
        await tx.leagueSettings.update({
          where: { id: league.settings.id },
          data: {
            rosterSize,
            benchSize,
            positionLimitsJson,
            autoPickRulesJson,
          },
        });
        settingsCount += 1;
      }

      for (const draft of league.drafts) {
        if (draft.pickDeadlineAt && draft.pickDeadlineAt.getTime() > now.getTime()) continue;

        const pickSeconds = Math.max(15, Number(league.settings.pickSeconds || 60));
        const pickDeadlineAt = new Date(now.getTime() + pickSeconds * 1000);
        const repairedDraft = await tx.draft.update({
          where: { id: draft.id },
          data: {
            pickStartedAt: draft.pickStartedAt ?? now,
            pickDeadlineAt,
            schedulingVersion: { increment: 1 },
          },
          select: {
            id: true,
            leagueId: true,
            schedulingVersion: true,
            pickDeadlineAt: true,
          },
        });
        if (repairedDraft.pickDeadlineAt) {
          repairedPickExpiryJobs.push({
            draftId: repairedDraft.id,
            leagueId: repairedDraft.leagueId,
            schedulingVersion: repairedDraft.schedulingVersion,
            pickDeadlineAt: repairedDraft.pickDeadlineAt,
          });
        }
        deadlineCount += 1;
      }
    }

    return { categoryCount, settingsCount, deadlineCount };
  });

  if (
    runtimeRepair.categoryCount > 0 ||
    runtimeRepair.settingsCount > 0 ||
    runtimeRepair.deadlineCount > 0
  ) {
    console.log(
      `[local-seed] Repaired ${runtimeRepair.categoryCount} legacy league category records, ${runtimeRepair.settingsCount} draft settings records, and ${runtimeRepair.deadlineCount} live draft deadline records`
    );
  }

  if (repairedPickExpiryJobs.length > 0) {
    const { draftQueue, scheduleDraftPickExpiry } = await import('../../src/server/queue/draftQueue');
    const { ScalableRedisConnection } = await import('../../src/server/realtime/scalableConnection');

    for (const job of repairedPickExpiryJobs) {
      await scheduleDraftPickExpiry(
        {
          kind: 'draft:pick-expiry',
          draftId: job.draftId,
          leagueId: job.leagueId,
          schedulingVersion: job.schedulingVersion,
        },
        job.pickDeadlineAt
      );
    }

    await draftQueue.close();
    await ScalableRedisConnection.getInstance().shutdown();
    console.log(
      `[local-seed] Scheduled ${repairedPickExpiryJobs.length} repaired live draft pick expiry jobs`
    );
  }

  await adminDb.collection('users').doc(DEVELOPMENT_AUTH_USER_ID).set(
    {
      uid: DEVELOPMENT_AUTH_USER_ID,
      email: DEVELOPMENT_AUTH_EMAIL,
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      localStack: true,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  console.log(`[local-seed] Upserted Firestore user ${DEVELOPMENT_AUTH_USER_ID}`);

  console.log(`[local-seed] Local login ready: ${DEVELOPMENT_AUTH_EMAIL} / ${localAuthPhrase}`);
}

main().catch((error) => {
  console.error('[local-seed] Failed to seed local stack', error);
  process.exit(1);
});
