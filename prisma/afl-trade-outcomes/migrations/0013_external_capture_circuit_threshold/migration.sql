-- Consecutive failures may accumulate below a schedule's circuit threshold without opening it.

ALTER TABLE outcome_external_capture_provider_circuit
  DROP CONSTRAINT outcome_external_capture_provider_circuit_failure_check;

ALTER TABLE outcome_external_capture_provider_circuit
  ADD CONSTRAINT outcome_external_capture_provider_circuit_failure_check
  CHECK (
    consecutive_failures >= 0 AND
    (opened_at IS NULL OR consecutive_failures > 0)
  );
