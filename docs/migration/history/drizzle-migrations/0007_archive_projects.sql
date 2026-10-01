-- Project archiving: an archived project is hidden from the app for members,
-- stays readable for history/reporting, and is read-only for every signed-in
-- user until an account admin (or super admin) restores it.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS projects_archived_at_idx
  ON public.projects (archived_at)
  WHERE archived_at IS NOT NULL;

-- Guard the project row itself: only account admins / super admins may flip
-- the archive state from a user session, and an archived project cannot be
-- edited until it is restored. Trusted server code (no auth.uid()) is allowed;
-- it performs its own centralized authorization first.
CREATE OR REPLACE FUNCTION public.guard_project_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    IF NOT (public.is_global_admin(auth.uid()) OR public.is_account_admin(auth.uid(), OLD.account_id)) THEN
      RAISE EXCEPTION 'Only account admins can archive or restore a project' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This project is archived. Restore it to make changes.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_guard_archive ON public.projects;
CREATE TRIGGER projects_guard_archive
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_archive();

-- Block user-session writes to anything inside an archived project.
-- TG_ARGV[0] = 'project' (row has project_id) or 'ticket' (row has ticket_id).
-- When a project is deleted, cascaded child deletes find no project row and
-- pass through, so permanent delete keeps working.
CREATE OR REPLACE FUNCTION public.block_archived_project_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rows jsonb[] := ARRAY[]::jsonb[];
  _r jsonb;
  _project uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

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
      RAISE EXCEPTION 'This project is archived. Restore it to make changes.' USING ERRCODE = 'P0001';
    END IF;
    _project := NULL;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tickets','sprints','board_columns','documents','document_folders','epics'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_block_archived', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.block_archived_project_writes(''project'')',
      t || '_block_archived', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['work_logs','comments','attachments','ticket_estimates','ticket_epics','ticket_watchers'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_block_archived', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.block_archived_project_writes(''ticket'')',
      t || '_block_archived', t);
  END LOOP;
END $$;

-- P0.3 convention: trigger-only SECURITY DEFINER functions are not callable by clients.
REVOKE ALL ON FUNCTION public.guard_project_archive() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_archived_project_writes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_project_archive() TO service_role;
GRANT EXECUTE ON FUNCTION public.block_archived_project_writes() TO service_role;