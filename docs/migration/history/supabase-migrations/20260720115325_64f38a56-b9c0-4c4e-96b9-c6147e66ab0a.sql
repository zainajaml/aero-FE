DROP POLICY IF EXISTS "tickets dev write" ON public.tickets;
CREATE POLICY "tickets dev write" ON public.tickets FOR INSERT
WITH CHECK (
  is_project_member(project_id, auth.uid())
  AND (
    is_global_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['admin'::app_role, 'team'::app_role, 'developer'::app_role])
    )
  )
);