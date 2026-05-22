-- Historical manual SQL retained outside Prisma's directory-based migrations.
-- Add timezone support to drafts and users
ALTER TABLE "LeagueSettings" ADD COLUMN "timeZone" TEXT DEFAULT 'UTC';
ALTER TABLE "User" ADD COLUMN "preferredTimeZone" TEXT DEFAULT 'UTC';

-- Add draft reminders table
CREATE TABLE "DraftReminder" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL, -- 'email', 'sms', 'push'
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftReminder_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX "DraftReminder_draftId_idx" ON "DraftReminder"("draftId");
CREATE INDEX "DraftReminder_userId_idx" ON "DraftReminder"("userId");
CREATE INDEX "DraftReminder_scheduledFor_sent_idx" ON "DraftReminder"("scheduledFor", "sent");

-- Add foreign key constraints
ALTER TABLE "DraftReminder" ADD CONSTRAINT "DraftReminder_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftReminder" ADD CONSTRAINT "DraftReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
