ALTER TABLE "outcome_event_party"
  DROP CONSTRAINT "outcome_event_party_ordinal_check";

ALTER TABLE "outcome_event_party"
  ADD CONSTRAINT "outcome_event_party_ordinal_check" CHECK ("ordinal" > 0) NOT VALID;
