-- Support draft-wide removal when a player is selected.
CREATE INDEX "PreDraftQueue_draftId_playerId_idx"
ON "PreDraftQueue"("draftId", "playerId");
