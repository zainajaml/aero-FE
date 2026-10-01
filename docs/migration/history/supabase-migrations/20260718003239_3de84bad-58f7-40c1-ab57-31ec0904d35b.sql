DROP FUNCTION IF EXISTS public.list_visible_profiles(uuid[]);
DROP FUNCTION IF EXISTS public.list_project_accessible_users(uuid);

CREATE OR REPLACE FUNCTION public.list_visible_profiles(_ids uuid[])
 RETURNS TABLE(id uuid, full_name text, first_name text, last_name text, avatar_url text, job_title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name, p.first_name, p.last_name, p.avatar_url, p.job_title
  FROM public.profiles p
  WHERE p.id = ANY(_ids)
    AND (
      p.id = auth.uid()
      OR public.is_spaceman(auth.uid())
      OR public.shares_project(p.id, auth.uid())
    )
$function$;

CREATE OR REPLACE FUNCTION public.list_project_accessible_users(_project uuid)
 RETURNS TABLE(user_id uuid, role text, full_name text, first_name text, last_name text, avatar_url text, job_title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pm.user_id, pm.role::text AS role, p.full_name, p.first_name, p.last_name, p.avatar_url, p.job_title
  FROM public.project_members pm
  LEFT JOIN public.profiles p ON p.id = pm.user_id
  WHERE pm.project_id = _project
    AND public.is_project_member(_project, auth.uid());
$function$;