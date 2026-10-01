-- Allow project managers/admins to log and edit time on behalf of anyone,
-- while regular users remain limited to their own logged time.

DROP POLICY IF EXISTS "wlogs own write" ON public.work_logs;
CREATE POLICY "wlogs write" ON public.work_logs
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = work_logs.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
  )
  AND (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = work_logs.ticket_id
        AND public.can_manage_project(t.project_id, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "wlogs own update" ON public.work_logs;
CREATE POLICY "wlogs update" ON public.work_logs
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = work_logs.ticket_id
      AND public.can_manage_project(t.project_id, auth.uid())
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = work_logs.ticket_id
      AND public.can_manage_project(t.project_id, auth.uid())
  )
);