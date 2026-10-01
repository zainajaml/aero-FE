
CREATE OR REPLACE FUNCTION public.list_project_accessible_users(_project uuid)
 RETURNS TABLE(user_id uuid, role text, full_name text, first_name text, last_name text, avatar_url text, job_title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.user_id, u.role, p.full_name, p.first_name, p.last_name, p.avatar_url, p.job_title
  FROM (
    SELECT pm.user_id, pm.role::text AS role
    FROM public.project_members pm
    WHERE pm.project_id = _project
    UNION
    SELECT aa.user_id, 'account_admin'::text AS role
    FROM public.account_admins aa
    JOIN public.projects pr ON pr.account_id = aa.account_id
    WHERE pr.id = _project
  ) u
  LEFT JOIN public.profiles p ON p.id = u.user_id
  WHERE public.is_project_member(_project, auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.user_id AND ur.role = 'super_admin'
    );
$function$;
