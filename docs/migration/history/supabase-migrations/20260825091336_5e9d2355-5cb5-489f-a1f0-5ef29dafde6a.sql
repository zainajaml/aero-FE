DROP POLICY IF EXISTS "sprints pm update" ON public.sprints;
DROP POLICY IF EXISTS "sprints pm delete" ON public.sprints;

CREATE POLICY "sprints member update" ON public.sprints
FOR UPDATE TO authenticated
USING (
  public.is_project_member(project_id, auth.uid())
  AND NOT public.is_project_viewer(project_id, auth.uid())
  AND NOT public.is_archived(auth.uid())
)
WITH CHECK (
  public.is_project_member(project_id, auth.uid())
  AND NOT public.is_project_viewer(project_id, auth.uid())
  AND NOT public.is_archived(auth.uid())
);

CREATE POLICY "sprints member delete" ON public.sprints
FOR DELETE TO authenticated
USING (
  public.is_project_member(project_id, auth.uid())
  AND NOT public.is_project_viewer(project_id, auth.uid())
  AND NOT public.is_archived(auth.uid())
);