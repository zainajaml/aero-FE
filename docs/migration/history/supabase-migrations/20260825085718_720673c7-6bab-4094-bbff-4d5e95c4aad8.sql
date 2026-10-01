DROP POLICY IF EXISTS "sprints pm write" ON public.sprints;

CREATE POLICY "sprints member create"
ON public.sprints
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_project_member(project_id, auth.uid())
  AND NOT public.is_project_viewer(project_id, auth.uid())
);