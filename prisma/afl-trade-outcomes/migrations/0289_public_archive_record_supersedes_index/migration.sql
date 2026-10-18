-- Supersession lookups in the public archive read path compare
-- record_json#>>'{record,supersedesVersionId}' within one archive, once per current record on every page.
-- No index covered that expression, so each cold read rescanned the archive. This index serves those
-- anti-joins. It is an expression index, which the Prisma schema cannot declare, so it lives only here.
CREATE INDEX "outcome_public_factual_archive_record_supersedes_idx"
  ON "outcome_public_factual_archive_record" (
    "archive_id",
    "record_kind",
    ((record_json #>> '{record,supersedesVersionId}'))
  );
