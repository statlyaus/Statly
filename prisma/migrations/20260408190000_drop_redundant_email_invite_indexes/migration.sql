-- Unique constraints on User.email and League.inviteCode already provide indexes.
DROP INDEX IF EXISTS "User_email_idx";
DROP INDEX IF EXISTS "League_inviteCode_idx";
