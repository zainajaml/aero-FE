CREATE OR REPLACE FUNCTION public.can_manage_project(_project uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_global_admin(_user)
      OR public.is_account_admin_of_project(_project, _user)
      OR EXISTS(
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = _project
          AND pm.user_id = _user
          AND pm.role = 'admin'::public.app_role
      );
$function$;