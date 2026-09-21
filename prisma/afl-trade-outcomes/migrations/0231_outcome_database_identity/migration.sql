-- The database states what it is.
--
-- SQLite's file header carries an application id, a schema format number, and the version that
-- wrote it, so any reader can tell whether it understands the file it was handed. This database had
-- no equivalent: schema drift was only ever detected by a test, never by the database itself.
--
-- The row is written here and re-asserted immediately afterwards, so a deploy that applies this
-- migration either exposes a correct identity or fails loudly. `schema_format` is the compatibility
-- contract and changes only deliberately, when a reader that understands the old contract would
-- misread a new one. The applied migration head is deliberately not duplicated here: the ledger
-- already reports it, and a copy would rot.
CREATE TABLE outcome_database_identity (
  singleton_id INTEGER PRIMARY KEY,
  application_id TEXT NOT NULL,
  schema_format INTEGER NOT NULL,
  stamped_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT outcome_database_identity_singleton_check CHECK (singleton_id=1),
  CONSTRAINT outcome_database_identity_application_check
    CHECK (application_id='statly-afl-trade-outcomes'),
  CONSTRAINT outcome_database_identity_format_check CHECK (schema_format=1)
);

INSERT INTO outcome_database_identity (singleton_id,application_id,schema_format)
VALUES (1,'statly-afl-trade-outcomes',1)
ON CONFLICT (singleton_id) DO NOTHING;

DO $$
DECLARE identity RECORD;
BEGIN
  SELECT * INTO identity FROM outcome_database_identity;
  IF NOT FOUND
    OR identity.singleton_id<>1
    OR identity.application_id<>'statly-afl-trade-outcomes'
    OR identity.schema_format<>1
    OR identity.stamped_at IS NULL
  THEN RAISE EXCEPTION 'Outcome database identity is not the expected application and schema format'; END IF;
END $$;

REVOKE ALL ON TABLE outcome_database_identity FROM PUBLIC;
