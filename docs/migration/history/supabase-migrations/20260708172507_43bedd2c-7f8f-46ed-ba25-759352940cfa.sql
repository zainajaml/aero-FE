-- Finding: comments_missing_delete_scope_check
-- Tighten comments UPDATE to require the author still be a project member
DROP POLICY IF EXISTS "comments own update" ON public.comments;
CREATE POLICY "comments own update" ON public.comments
FOR UPDATE
USING (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = comments.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
  )
)
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = comments.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
  )
);

-- Reaffirm comments DELETE requires author-or-manager AND active project membership
DROP POLICY IF EXISTS "comments own delete" ON public.comments;
CREATE POLICY "comments own delete" ON public.comments
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = comments.ticket_id
      AND public.is_project_member(t.project_id, auth.uid())
      AND (
        comments.author_id = auth.uid()
        OR public.can_manage_project(t.project_id, auth.uid())
      )
  )
);

-- Finding: email_send_state_no_read_restriction_beyond_service_role
-- Add an explicit RESTRICTIVE policy so only the service role can ever access
-- this operational config, regardless of any future permissive grants/policies.
DROP POLICY IF EXISTS "email_send_state service role only" ON public.email_send_state;
CREATE POLICY "email_send_state service role only" ON public.email_send_state
AS RESTRICTIVE
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
