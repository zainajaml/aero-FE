
-- Client admins need to see audit logs for the projects they belong to.
CREATE POLICY "audit project member read"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    project_id IS NOT NULL
    AND public.has_role(auth.uid(), 'client_admin'::public.app_role)
    AND public.is_project_member(project_id, auth.uid())
  );
