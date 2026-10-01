CREATE OR REPLACE FUNCTION public.is_project_member(_project uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_global_admin(_user)
      OR public.is_account_admin_of_project(_project, _user)
      OR EXISTS (SELECT 1 FROM public.project_members WHERE project_id = _project AND user_id = _user);
$$;