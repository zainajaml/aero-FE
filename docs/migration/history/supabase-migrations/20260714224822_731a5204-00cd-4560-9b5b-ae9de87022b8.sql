ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'client_team';

COMMIT;

CREATE OR REPLACE FUNCTION public.is_client(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.user_roles
    where user_id=_user and role in ('client_admin','client_developer','client_viewer','client_team'));
$function$;