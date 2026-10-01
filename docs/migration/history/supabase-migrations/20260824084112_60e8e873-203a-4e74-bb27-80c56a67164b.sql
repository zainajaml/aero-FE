CREATE OR REPLACE FUNCTION public.is_archived(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN _user IS NULL THEN false ELSE EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = _user AND p.archived_at IS NOT NULL
  ) END;
$$;

REVOKE ALL ON FUNCTION public.is_archived(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_archived(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_global_admin(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select not public.is_archived(_user)
     and exists(select 1 from public.user_roles where user_id = _user and role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_spaceman(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select not public.is_archived(_user)
     and exists(select 1 from public.user_roles where user_id = _user and role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_spaceman_staff(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select not public.is_archived(_user)
     and exists(select 1 from public.user_roles where user_id = _user and role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_account_admin(_user uuid, _account uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT public.is_archived(_user)
     AND EXISTS (SELECT 1 FROM public.account_admins WHERE account_id = _account AND user_id = _user);
$$;

CREATE OR REPLACE FUNCTION public.is_account_admin_of_project(_project uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT public.is_archived(_user) AND EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.account_admins aa ON aa.account_id = p.account_id
    WHERE p.id = _project AND aa.user_id = _user
  );
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(_project uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT public.is_archived(_user)
     AND (public.is_global_admin(_user)
       OR public.is_account_admin_of_project(_project, _user)
       OR EXISTS (SELECT 1 FROM public.project_members WHERE project_id = _project AND user_id = _user));
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(_project uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT public.is_archived(_user)
     AND (public.is_global_admin(_user)
       OR public.is_account_admin_of_project(_project, _user)
       OR EXISTS(
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = _project
              AND pm.user_id = _user
              AND pm.role = 'admin'::public.app_role
          ));
$$;

CREATE OR REPLACE FUNCTION public.is_client(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select not public.is_archived(_user)
     and exists(select 1 from public.user_roles
                 where user_id = _user
                   and role in ('admin','developer','viewer','team'));
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_any_role(_roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select not public.is_archived(auth.uid())
     and exists (select 1 from public.user_roles where user_id = auth.uid() and role = any(_roles));
$$;

CREATE OR REPLACE FUNCTION public.shares_project(_other uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT public.is_archived(_user) AND (EXISTS (
    SELECT 1
    FROM project_members pm1
    JOIN project_members pm2 ON pm1.project_id = pm2.project_id
    WHERE pm1.user_id = _user AND pm2.user_id = _other
  ) OR EXISTS (
    SELECT 1
    FROM account_admins aa
    JOIN projects p ON p.account_id = aa.account_id
    JOIN project_members pm ON pm.project_id = p.id
    WHERE (aa.user_id = _user AND pm.user_id = _other)
       OR (aa.user_id = _other AND pm.user_id = _user)
  ) OR EXISTS (
    SELECT 1
    FROM account_admins a1
    JOIN account_admins a2 ON a1.account_id = a2.account_id
    WHERE a1.user_id = _user AND a2.user_id = _other
  ));
$$;

CREATE OR REPLACE FUNCTION public.list_project_accessible_users(_project uuid)
RETURNS TABLE(user_id uuid, role text, full_name text, first_name text, last_name text, avatar_url text, job_title text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    AND p.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.user_id AND ur.role = 'super_admin'
    );
$$;