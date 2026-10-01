
DROP POLICY IF EXISTS "audit admin read" ON public.audit_logs;
DROP POLICY IF EXISTS "audit project member read" ON public.audit_logs;

CREATE POLICY "audit super admin read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_global_admin(auth.uid()));

CREATE POLICY "audit account admin read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.account_admins aa ON aa.account_id = p.account_id
      WHERE p.id = audit_logs.project_id AND aa.user_id = auth.uid()
    )
  );

CREATE POLICY "audit project admin read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    project_id IS NOT NULL
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.is_project_member(project_id, auth.uid())
  );
