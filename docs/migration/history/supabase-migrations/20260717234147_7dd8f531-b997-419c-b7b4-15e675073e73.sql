
-- 1) Migrate existing rows into labels that already exist in the enum.
UPDATE public.user_roles      SET role = 'admin'     WHERE role::text = 'client_admin';
UPDATE public.user_roles      SET role = 'developer' WHERE role::text IN ('client_developer','spaceman_developer');
UPDATE public.project_members SET role = 'admin'     WHERE role::text IN ('client_admin','pm');
UPDATE public.project_members SET role = 'developer' WHERE role::text IN ('client_developer','spaceman_developer');
UPDATE public.invitations     SET role = 'admin'     WHERE role::text = 'client_admin';
UPDATE public.invitations     SET role = 'developer' WHERE role::text IN ('client_developer','spaceman_developer');

-- 2) Rename remaining enum labels in place (references cascade).
ALTER TYPE public.app_role RENAME VALUE 'spaceman_admin'  TO 'super_admin';
ALTER TYPE public.app_role RENAME VALUE 'client_viewer'   TO 'viewer';
ALTER TYPE public.app_role RENAME VALUE 'client_team'     TO 'team';

-- 3) Migrate remaining Spaceman Viewer rows into the newly-created 'viewer' label.
UPDATE public.user_roles      SET role = 'viewer' WHERE role::text = 'spaceman_viewer';
UPDATE public.project_members SET role = 'viewer' WHERE role::text IN ('spaceman_viewer','client');
UPDATE public.invitations     SET role = 'viewer' WHERE role::text = 'spaceman_viewer';

-- 4) Rewrite role-check helpers to use the new names.
CREATE OR REPLACE FUNCTION public.is_global_admin(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists(select 1 from public.user_roles where user_id = _user and role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_spaceman(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists(select 1 from public.user_roles where user_id = _user and role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_spaceman_staff(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists(select 1 from public.user_roles where user_id = _user and role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_client(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists(select 1 from public.user_roles
                 where user_id = _user
                   and role in ('admin','developer','viewer','team'));
$$;

CREATE OR REPLACE FUNCTION public.is_viewer(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists(select 1 from public.user_roles where user_id = _user and role = 'viewer');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(_project uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select public.is_global_admin(_user)
      or exists(
        select 1 from public.project_members pm
        join public.user_roles ur on ur.user_id = pm.user_id
        where pm.project_id = _project
          and pm.user_id = _user
          and ur.role = 'admin'
      );
$$;

-- 5) Developers cannot create tickets; keep update/delete rules intact.
DROP POLICY IF EXISTS "tickets dev write" ON public.tickets;
CREATE POLICY "tickets dev write" ON public.tickets
  FOR INSERT
  WITH CHECK (
    public.is_project_member(project_id, auth.uid())
    AND (
      public.is_global_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role IN ('admin','team')
      )
    )
  );

-- 6) New-user defaults use the new role names.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  is_first boolean;
  inv public.invitations;
  proj_ids uuid[];
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  select * into inv
  from public.invitations
  where lower(email) = lower(new.email)
    and accepted_at is null
  order by created_at desc
  limit 1;

  if inv.id is not null then
    insert into public.user_roles (user_id, role)
    values (new.id, inv.role)
    on conflict do nothing;

    proj_ids := coalesce(
      inv.project_ids,
      case when inv.project_id is not null then array[inv.project_id] else '{}'::uuid[] end
    );

    if array_length(proj_ids, 1) is not null then
      insert into public.project_members (project_id, user_id, role)
      select pid, new.id, inv.role
      from unnest(proj_ids) as pid
      on conflict (project_id, user_id) do nothing;
    end if;

    if inv.job_title is not null then
      update public.profiles set job_title = inv.job_title where id = new.id;
    end if;

    update public.invitations
    set accepted_at = now()
    where lower(email) = lower(new.email)
      and accepted_at is null;
  else
    select count(*) = 0 from public.user_roles into is_first;
    insert into public.user_roles (user_id, role)
    values (new.id, case when is_first then 'super_admin'::public.app_role else 'viewer'::public.app_role end)
    on conflict do nothing;
  end if;

  return new;
end;
$$;
