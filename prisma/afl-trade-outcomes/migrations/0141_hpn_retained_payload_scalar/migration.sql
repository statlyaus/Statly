-- Read retained fitzRoy envelopes without rewriting or rehashing source payloads.
-- SQL NULL means invalid/absent; JSON null means an explicit missing/nonfinite cell.
CREATE OR REPLACE FUNCTION outcome_hpn_pav_scalar(payload JSONB, field_name TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE cells JSONB; scalar JSONB; scalar_kind TEXT; numeric_text TEXT;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR field_name IS NULL THEN
    RETURN NULL;
  END IF;
  cells := payload;
  IF payload ? 'values' THEN
    IF jsonb_typeof(payload->'values') IS DISTINCT FROM 'object' OR payload ? field_name THEN
      RETURN NULL;
    END IF;
    cells := payload->'values';
  END IF;
  scalar := cells->field_name;
  IF jsonb_typeof(scalar) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  scalar_kind := scalar->>'kind';
  IF scalar_kind IN ('integer','finite_number') THEN
    IF jsonb_typeof(scalar->'value') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
    numeric_text := scalar->>'value';
    IF (scalar_kind='integer' AND numeric_text !~ '^-?[0-9]+$') OR
       (scalar_kind='finite_number' AND numeric_text !~ '^-?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$') THEN
      RETURN NULL;
    END IF;
    RETURN to_jsonb(numeric_text::NUMERIC);
  ELSIF scalar_kind='logical' THEN
    IF jsonb_typeof(scalar->'value') IS DISTINCT FROM 'boolean' THEN RETURN NULL; END IF;
    RETURN scalar->'value';
  ELSIF scalar_kind IN ('text','factor','date','datetime') THEN
    IF jsonb_typeof(scalar->'value') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
    RETURN scalar->'value';
  ELSIF scalar_kind IN ('missing','nan','positive_infinity','negative_infinity') THEN
    IF scalar IS DISTINCT FROM jsonb_build_object('kind',scalar_kind) THEN RETURN NULL; END IF;
    RETURN 'null'::JSONB;
  END IF;
  RETURN NULL;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
  RETURN NULL;
END $$;
