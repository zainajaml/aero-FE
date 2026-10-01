CREATE POLICY "epics dev update"
ON public.epics
FOR UPDATE
TO authenticated
USING (is_project_member(project_id, auth.uid()) AND (NOT is_viewer(auth.uid())))
WITH CHECK (is_project_member(project_id, auth.uid()) AND (NOT is_viewer(auth.uid())));