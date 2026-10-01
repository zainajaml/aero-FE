CREATE OR REPLACE FUNCTION public.guard_project_account_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    IF NOT (public.is_global_admin(auth.uid())
            OR (public.is_account_admin(auth.uid(), OLD.account_id)
                AND public.is_account_admin(auth.uid(), NEW.account_id))) THEN
      RAISE EXCEPTION 'Only account administrators can move a project to another account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_project_account_move ON public.projects;
CREATE TRIGGER guard_project_account_move
BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.guard_project_account_move();

DROP POLICY IF EXISTS "projects pm update" ON public.projects;
CREATE POLICY "projects pm update" ON public.projects
FOR UPDATE TO authenticated
USING (public.can_manage_project(id, auth.uid()))
WITH CHECK (public.can_manage_project(id, auth.uid()));