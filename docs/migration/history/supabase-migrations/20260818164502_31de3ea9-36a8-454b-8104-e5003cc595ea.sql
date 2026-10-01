-- Viewers must be strictly read-only. Comments, work logs and attachment
-- deletion previously allowed any project member (including viewers) to write.

DROP POLICY IF EXISTS "comments own write" ON public.comments;
CREATE POLICY "comments own write" ON public.comments
FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = comments.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
      AND NOT public.is_project_viewer(t.project_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "comments own update" ON public.comments;
CREATE POLICY "comments own update" ON public.comments
FOR UPDATE TO authenticated
USING (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = comments.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
      AND NOT public.is_project_viewer(t.project_id, auth.uid())
  )
)
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = comments.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
      AND NOT public.is_project_viewer(t.project_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "comments own delete" ON public.comments;
CREATE POLICY "comments own delete" ON public.comments
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = comments.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
      AND (
        public.can_manage_project(t.project_id, auth.uid())
        OR (comments.author_id = auth.uid()
            AND NOT public.is_project_viewer(t.project_id, auth.uid()))
      )
  )
);

DROP POLICY IF EXISTS "wlogs write" ON public.work_logs;
CREATE POLICY "wlogs write" ON public.work_logs
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = work_logs.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
      AND NOT public.is_project_viewer(t.project_id, auth.uid())
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

DROP POLICY IF EXISTS "wlogs update" ON public.work_logs;
CREATE POLICY "wlogs update" ON public.work_logs
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = work_logs.ticket_id
      AND (
        public.can_manage_project(t.project_id, auth.uid())
        OR (work_logs.user_id = auth.uid()
            AND NOT public.is_project_viewer(t.project_id, auth.uid()))
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = work_logs.ticket_id
      AND (
        public.can_manage_project(t.project_id, auth.uid())
        OR (work_logs.user_id = auth.uid()
            AND NOT public.is_project_viewer(t.project_id, auth.uid()))
      )
  )
);

DROP POLICY IF EXISTS "wlogs own delete" ON public.work_logs;
CREATE POLICY "wlogs own delete" ON public.work_logs
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = work_logs.ticket_id
      AND (
        public.can_manage_project(t.project_id, auth.uid())
        OR (work_logs.user_id = auth.uid()
            AND NOT public.is_project_viewer(t.project_id, auth.uid()))
      )
  )
);

DROP POLICY IF EXISTS "att delete" ON public.attachments;
CREATE POLICY "att delete" ON public.attachments
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = attachments.ticket_id
      AND (
        public.can_manage_project(t.project_id, auth.uid())
        OR (attachments.uploaded_by = auth.uid()
            AND public.is_project_member(t.project_id, auth.uid())
            AND NOT public.is_project_viewer(t.project_id, auth.uid()))
      )
  )
);

DROP POLICY IF EXISTS "watchers self write" ON public.ticket_watchers;
CREATE POLICY "watchers self write" ON public.ticket_watchers
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_watchers.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
      AND NOT public.is_project_viewer(t.project_id, auth.uid())
  )
);