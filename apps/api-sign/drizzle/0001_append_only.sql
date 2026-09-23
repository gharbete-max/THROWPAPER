-- Evidence is append-only, enforced where every writer has to pass: the database.
--
-- An application rule ("we never update these") holds only for the code that remembers it. A
-- trigger holds for a migration, a psql session and a future repository alike. Changing a signed
-- record is not a thing Sign does; a correction is a new envelope, a new version, a new event.
CREATE FUNCTION sign_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER documents_append_only BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION sign_refuse_change();
--> statement-breakpoint
CREATE TRIGGER documents_no_truncate BEFORE TRUNCATE ON documents
  FOR EACH STATEMENT EXECUTE FUNCTION sign_refuse_change();
--> statement-breakpoint
CREATE TRIGGER declarations_append_only BEFORE UPDATE OR DELETE ON declarations
  FOR EACH ROW EXECUTE FUNCTION sign_refuse_change();
--> statement-breakpoint
CREATE TRIGGER declarations_no_truncate BEFORE TRUNCATE ON declarations
  FOR EACH STATEMENT EXECUTE FUNCTION sign_refuse_change();
--> statement-breakpoint
CREATE TRIGGER envelopes_append_only BEFORE UPDATE OR DELETE ON envelopes
  FOR EACH ROW EXECUTE FUNCTION sign_refuse_change();
--> statement-breakpoint
CREATE TRIGGER envelopes_no_truncate BEFORE TRUNCATE ON envelopes
  FOR EACH STATEMENT EXECUTE FUNCTION sign_refuse_change();
--> statement-breakpoint
CREATE TRIGGER envelope_events_append_only BEFORE UPDATE OR DELETE ON envelope_events
  FOR EACH ROW EXECUTE FUNCTION sign_refuse_change();
--> statement-breakpoint
CREATE TRIGGER envelope_events_no_truncate BEFORE TRUNCATE ON envelope_events
  FOR EACH STATEMENT EXECUTE FUNCTION sign_refuse_change();
