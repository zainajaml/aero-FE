CREATE OR REPLACE FUNCTION public.is_project_viewer(_project uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.is_global_admin(_user) THEN false
    WHEN public.is_account_admin_of_project(_project, _user) THEN false
    ELSE coalesce(
      (SELECT pm.role = 'viewer'::public.app_role
         FROM public.project_members pm
        WHERE pm.project_id = _project AND pm.user_id = _user),
      true)
  END;
$$;

-- tickets
DROP POLICY IF EXISTS "tickets dev write" ON public.tickets;
CREATE POLICY "tickets dev write" ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()));
DROP POLICY IF EXISTS "tickets dev update" ON public.tickets;
CREATE POLICY "tickets dev update" ON public.tickets FOR UPDATE TO authenticated
  USING (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()))
  WITH CHECK (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()));

-- epics
DROP POLICY IF EXISTS "epics dev write" ON public.epics;
CREATE POLICY "epics dev write" ON public.epics FOR INSERT TO authenticated
  WITH CHECK (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()) AND created_by = auth.uid());
DROP POLICY IF EXISTS "epics dev update" ON public.epics;
CREATE POLICY "epics dev update" ON public.epics FOR UPDATE TO authenticated
  USING (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()))
  WITH CHECK (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()));

-- documents
DROP POLICY IF EXISTS "docs member write" ON public.documents;
CREATE POLICY "docs member write" ON public.documents FOR INSERT TO authenticated
  WITH CHECK (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()) AND created_by = auth.uid());
DROP POLICY IF EXISTS "docs member update" ON public.documents;
CREATE POLICY "docs member update" ON public.documents FOR UPDATE TO authenticated
  USING (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()))
  WITH CHECK (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()));

-- document folders
DROP POLICY IF EXISTS "folders member write" ON public.document_folders;
CREATE POLICY "folders member write" ON public.document_folders FOR INSERT TO authenticated
  WITH CHECK (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()) AND created_by = auth.uid());
DROP POLICY IF EXISTS "folders member update" ON public.document_folders;
CREATE POLICY "folders member update" ON public.document_folders FOR UPDATE TO authenticated
  USING (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()))
  WITH CHECK (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()));

-- stage history
DROP POLICY IF EXISTS "stage history member write" ON public.ticket_stage_history;
CREATE POLICY "stage history member write" ON public.ticket_stage_history FOR INSERT TO authenticated
  WITH CHECK (is_project_member(project_id, auth.uid()) AND NOT is_project_viewer(project_id, auth.uid()) AND (moved_by = auth.uid() OR moved_by IS NULL));

-- ticket epics
DROP POLICY IF EXISTS "ticket_epics dev write" ON public.ticket_epics;
CREATE POLICY "ticket_epics dev write" ON public.ticket_epics FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_epics.ticket_id
    AND is_project_member(t.project_id, auth.uid()) AND NOT is_project_viewer(t.project_id, auth.uid())));
DROP POLICY IF EXISTS "ticket_epics dev delete" ON public.ticket_epics;
CREATE POLICY "ticket_epics dev delete" ON public.ticket_epics FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_epics.ticket_id
    AND is_project_member(t.project_id, auth.uid()) AND NOT is_project_viewer(t.project_id, auth.uid())));

-- ticket estimates
DROP POLICY IF EXISTS "est dev write" ON public.ticket_estimates;
CREATE POLICY "est dev write" ON public.ticket_estimates FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_estimates.ticket_id
    AND is_project_member(t.project_id, auth.uid()) AND NOT is_project_viewer(t.project_id, auth.uid())));
DROP POLICY IF EXISTS "est dev update" ON public.ticket_estimates;
CREATE POLICY "est dev update" ON public.ticket_estimates FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_estimates.ticket_id
    AND is_project_member(t.project_id, auth.uid()) AND NOT is_project_viewer(t.project_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_estimates.ticket_id
    AND is_project_member(t.project_id, auth.uid()) AND NOT is_project_viewer(t.project_id, auth.uid())));
DROP POLICY IF EXISTS "est delete" ON public.ticket_estimates;
CREATE POLICY "est delete" ON public.ticket_estimates FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_estimates.ticket_id
    AND (can_manage_project(t.project_id, auth.uid())
      OR (is_project_member(t.project_id, auth.uid()) AND NOT is_project_viewer(t.project_id, auth.uid())))));

-- attachments
DROP POLICY IF EXISTS "att dev write" ON public.attachments;
CREATE POLICY "att dev write" ON public.attachments FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.tickets t
    WHERE t.id = attachments.ticket_id AND is_project_member(t.project_id, auth.uid())
      AND NOT is_project_viewer(t.project_id, auth.uid())));