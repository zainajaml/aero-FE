CREATE OR REPLACE FUNCTION public.can_manage_project(_project uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Global admins can always manage. Otherwise the user must both be a member
  -- of THIS project AND hold one of the explicitly intended elevated roles.
  -- Only client_admin and spaceman_developer are permitted here; no other
  -- (legacy or lower) role grants project management rights.
  select public.is_global_admin(_user)
      or (
        exists(
          select 1 from public.project_members pm
          where pm.project_id = _project
            and pm.user_id = _user
        )
        and exists(
          select 1 from public.user_roles ur
          where ur.user_id = _user
            and ur.role in ('client_admin'::public.app_role, 'spaceman_developer'::public.app_role)
        )
      );
$function$;