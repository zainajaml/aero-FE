-- board_columns
DROP POLICY IF EXISTS "cols pm update" ON public.board_columns;
CREATE POLICY "cols pm update" ON public.board_columns
FOR UPDATE TO authenticated
USING (public.can_manage_project(project_id, auth.uid()))
WITH CHECK (public.can_manage_project(project_id, auth.uid()));

-- sprints
DROP POLICY IF EXISTS "sprints pm update" ON public.sprints;
CREATE POLICY "sprints pm update" ON public.sprints
FOR UPDATE TO authenticated
USING (public.can_manage_project(project_id, auth.uid()))
WITH CHECK (public.can_manage_project(project_id, auth.uid()));

-- document_folders
DROP POLICY IF EXISTS "folders member update" ON public.document_folders;
CREATE POLICY "folders member update" ON public.document_folders
FOR UPDATE TO authenticated
USING (public.is_project_member(project_id, auth.uid()) AND NOT public.is_viewer(auth.uid()))
WITH CHECK (public.is_project_member(project_id, auth.uid()) AND NOT public.is_viewer(auth.uid()));

-- documents
DROP POLICY IF EXISTS "docs member update" ON public.documents;
CREATE POLICY "docs member update" ON public.documents
FOR UPDATE TO authenticated
USING (public.is_project_member(project_id, auth.uid()) AND NOT public.is_viewer(auth.uid()))
WITH CHECK (public.is_project_member(project_id, auth.uid()) AND NOT public.is_viewer(auth.uid()));

-- tickets
DROP POLICY IF EXISTS "tickets dev update" ON public.tickets;
CREATE POLICY "tickets dev update" ON public.tickets
FOR UPDATE TO authenticated
USING (public.is_project_member(project_id, auth.uid()) AND NOT public.is_viewer(auth.uid()))
WITH CHECK (public.is_project_member(project_id, auth.uid()) AND NOT public.is_viewer(auth.uid()));

-- ticket_estimates
DROP POLICY IF EXISTS "est dev update" ON public.ticket_estimates;
CREATE POLICY "est dev update" ON public.ticket_estimates
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_estimates.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
  ) AND NOT public.is_viewer(auth.uid())
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_estimates.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
  ) AND NOT public.is_viewer(auth.uid())
);

-- projects: also validate the target account on the new row
DROP POLICY IF EXISTS "projects pm update" ON public.projects;
CREATE POLICY "projects pm update" ON public.projects
FOR UPDATE TO authenticated
USING (public.can_manage_project(id, auth.uid()))
WITH CHECK (
  public.can_manage_project(id, auth.uid())
  AND (
    public.is_global_admin(auth.uid())
    OR public.is_account_admin(auth.uid(), account_id)
  )
);