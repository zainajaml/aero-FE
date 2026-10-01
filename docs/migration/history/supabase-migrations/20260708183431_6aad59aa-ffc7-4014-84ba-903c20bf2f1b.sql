-- Finding: comments_policies_applies_to_public
-- Restrict comments update/delete policies to the authenticated role.
DROP POLICY IF EXISTS "comments own delete" ON public.comments;
CREATE POLICY "comments own delete" ON public.comments
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = comments.ticket_id
      AND is_project_member(t.project_id, auth.uid())
      AND ((comments.author_id = auth.uid()) OR can_manage_project(t.project_id, auth.uid()))
  ));

DROP POLICY IF EXISTS "comments own update" ON public.comments;
CREATE POLICY "comments own update" ON public.comments
  FOR UPDATE TO authenticated
  USING ((author_id = auth.uid()) AND EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = comments.ticket_id AND is_project_member(t.project_id, auth.uid())
  ))
  WITH CHECK ((author_id = auth.uid()) AND EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = comments.ticket_id AND is_project_member(t.project_id, auth.uid())
  ));

-- Finding: email_send_state_public_role_grant
-- Scope the service-role-only policies on email tables to the service_role role.

-- email_send_state
DROP POLICY IF EXISTS "Service role can manage send state" ON public.email_send_state;
CREATE POLICY "Service role can manage send state" ON public.email_send_state
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "email_send_state service role only" ON public.email_send_state;
CREATE POLICY "email_send_state service role only" ON public.email_send_state
  FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- email_send_log
DROP POLICY IF EXISTS "Service role can insert send log" ON public.email_send_log;
CREATE POLICY "Service role can insert send log" ON public.email_send_log
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can read send log" ON public.email_send_log;
CREATE POLICY "Service role can read send log" ON public.email_send_log
  FOR SELECT TO service_role
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can update send log" ON public.email_send_log;
CREATE POLICY "Service role can update send log" ON public.email_send_log
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- email_unsubscribe_tokens
DROP POLICY IF EXISTS "Service role can insert tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can mark tokens as used" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens
  FOR UPDATE TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can read tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens
  FOR SELECT TO service_role
  USING (auth.role() = 'service_role');

-- suppressed_emails
DROP POLICY IF EXISTS "Service role can insert suppressed emails" ON public.suppressed_emails;
CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails
  FOR INSERT TO service_role
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can read suppressed emails" ON public.suppressed_emails;
CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails
  FOR SELECT TO service_role
  USING (auth.role() = 'service_role');