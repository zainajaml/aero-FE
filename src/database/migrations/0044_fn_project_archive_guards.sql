-- Archived projects are read-only until restored. Who may archive/restore is decided by the
-- backend projects policy; the database guarantees the read-only invariant for every writer.
-- SQLSTATE AZ001 is mapped by the backend to a 409 PROJECT_ARCHIVED error.
CREATE OR REPLACE FUNCTION public.guard_project_archive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    RETURN NEW;
  END IF;
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This project is archived. Restore it to make changes.' USING ERRCODE = 'AZ001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER projects_guard_archive
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_archive();
--> statement-breakpoint
-- TG_ARGV[0] = 'project' (row has project_id) or 'ticket' (row has ticket_id).
-- Cascaded deletes from a deleted project find no project row and pass through.
CREATE OR REPLACE FUNCTION public.block_archived_project_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _rows jsonb[] := ARRAY[]::jsonb[];
  _r jsonb;
  _project uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN _rows := _rows || to_jsonb(OLD); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN _rows := _rows || to_jsonb(NEW); END IF;

  FOREACH _r IN ARRAY _rows LOOP
    IF TG_ARGV[0] = 'ticket' THEN
      SELECT t.project_id INTO _project FROM public.tickets t WHERE t.id = (_r->>'ticket_id')::uuid;
    ELSE
      _project := (_r->>'project_id')::uuid;
    END IF;
    IF _project IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = _project AND p.archived_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'This project is archived. Restore it to make changes.' USING ERRCODE = 'AZ001';
    END IF;
    _project := NULL;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tickets', 'sprints', 'board_columns', 'documents', 'document_folders', 'epics', 'rate_card'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.block_archived_project_writes(''project'')',
      t || '_block_archived', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['work_logs', 'comments', 'attachments', 'ticket_estimates', 'ticket_epics', 'ticket_watchers'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.block_archived_project_writes(''ticket'')',
      t || '_block_archived', t);
  END LOOP;
END $$;
