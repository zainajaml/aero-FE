CREATE OR REPLACE FUNCTION public.list_project_accessible_users(_project uuid)
RETURNS TABLE(user_id uuid, role text, full_name text, avatar_url text, job_title text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u.user_id, u.role, p.full_name, p.avatar_url, p.job_title
  FROM (
    SELECT pm.user_id, pm.role::text AS role
    FROM public.project_members pm
    WHERE pm.project_id = _project
    UNION
    SELECT ur.user_id, ur.role::text AS role
    FROM public.user_roles ur
    WHERE ur.role IN ('spaceman_admin','spaceman_developer','spaceman_viewer')
  ) u
  LEFT JOIN public.profiles p ON p.id = u.user_id
  WHERE public.is_project_member(_project, auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.list_project_accessible_users(uuid) TO authenticated;