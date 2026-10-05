ALTER TABLE "outcome_local_workbook_player_identity_review"
  DROP CONSTRAINT "outcome_local_workbook_player_iden_workbook_sha256_asset_id_key";

ALTER TABLE "outcome_local_workbook_player_identity_review"
  ADD CONSTRAINT "outcome_local_workbook_player_identity_review_bundle_key"
  UNIQUE ("workbook_sha256","asset_id","evidence_bundle_id");
