-- 1) Documents: require current active membership for creator-based delete
DROP POLICY IF EXISTS "docs delete" ON public.documents;
CREATE POLICY "docs delete" ON public.documents
FOR DELETE
USING (
  public.can_manage_project(project_id, auth.uid())
  OR (
    created_by = auth.uid()
    AND public.is_project_member(project_id, auth.uid())
    AND NOT public.is_project_viewer(project_id, auth.uid())
  )
);

-- 2) user_roles: tiered role granting
CREATE OR REPLACE FUNCTION public.can_grant_role(_granter uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _granter IS NULL THEN false
    -- only super admins may grant/modify the super_admin tier
    WHEN _role = 'super_admin'::public.app_role THEN public.is_global_admin(_granter)
    ELSE public.is_global_admin(_granter)
  END;
$$;

DROP POLICY IF EXISTS "roles admin write" ON public.user_roles;
CREATE POLICY "roles admin write" ON public.user_roles
FOR INSERT
WITH CHECK (
  public.is_global_admin(auth.uid())
  AND public.can_grant_role(auth.uid(), role)
);

DROP POLICY IF EXISTS "roles admin update" ON public.user_roles;
CREATE POLICY "roles admin update" ON public.user_roles
FOR UPDATE
USING (
  public.is_global_admin(auth.uid())
  AND public.can_grant_role(auth.uid(), role)
)
WITH CHECK (
  public.is_global_admin(auth.uid())
  AND public.can_grant_role(auth.uid(), role)
);