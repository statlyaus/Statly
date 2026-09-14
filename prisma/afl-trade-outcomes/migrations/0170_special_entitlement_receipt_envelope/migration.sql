-- Capture execution receipts are content-addressed envelopes. Preserve every authority predicate;
-- read its authenticated content instead of looking for payload fields on the envelope itself.
DO $$
DECLARE signature TEXT; definition TEXT; corrected TEXT; path TEXT;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'authenticate_outcome_special_entitlement_award(jsonb,text)',
  'authenticate_outcome_special_entitlement_lifecycle(jsonb,text)',
  'authenticate_outcome_special_entitlement_revision_lifecycle(jsonb,text,jsonb)',
  'authenticate_outcome_special_identity_replacement_review(jsonb,text)'
 ] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  corrected:=definition;
  FOREACH path IN ARRAY ARRAY['sourceRights','gate0aReceipt','schemaVersion'] LOOP
   IF strpos(corrected,'{executionReceipt,'||path)=0 THEN
    RAISE EXCEPTION 'Expected legacy receipt path missing in %: %',signature,path;
   END IF;
   corrected:=replace(corrected,'{executionReceipt,'||path,'{executionReceipt,content,'||path);
  END LOOP;
  IF corrected=definition THEN RAISE EXCEPTION 'Entitlement receipt correction made no change: %',signature; END IF;
  EXECUTE corrected;
 END LOOP;
END $$;
