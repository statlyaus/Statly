-- Add durable per-member notification preferences for league team settings.
ALTER TABLE "LeagueMember" ADD COLUMN "notificationSettingsJson" TEXT;
