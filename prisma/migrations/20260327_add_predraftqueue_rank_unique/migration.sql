-- Normalize queue ranks per draft/member before enforcing uniqueness.
WITH ranked_queue AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "draftId", "memberId"
      ORDER BY "rank" ASC, "createdAt" ASC, "id" ASC
    ) AS next_rank
  FROM "PreDraftQueue"
)
UPDATE "PreDraftQueue"
SET "rank" = (
  SELECT ranked_queue.next_rank
  FROM ranked_queue
  WHERE ranked_queue."id" = "PreDraftQueue"."id"
);

-- Enforce one rank per draft/member to keep queue order deterministic.
CREATE UNIQUE INDEX "PreDraftQueue_draftId_memberId_rank_key"
ON "PreDraftQueue"("draftId", "memberId", "rank");
