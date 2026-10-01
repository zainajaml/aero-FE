-- Multi-project invitations
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS project_ids uuid[];

-- Membership now drives visibility; only global admins bypass membership.
CREATE OR REPLACE FUNCTION public.is_project_member(_project uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_global_admin(_user)
      or exists(select 1 from public.project_members where project_id=_project and user_id=_user);
$function$;

-- Management scoped to membership (global admins bypass).
CREATE OR REPLACE FUNCTION public.can_manage_project(_project uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_global_admin(_user)
      or (exists(select 1 from public.project_members pm
                  where pm.project_id=_project and pm.user_id=_user)
          and exists(select 1 from public.user_roles ur
                  where ur.user_id=_user and ur.role in ('client_admin','spaceman_developer')));
$function$;

-- People visible inside a project = actual members of that project only.
CREATE OR REPLACE FUNCTION public.list_project_accessible_users(_project uuid)
 RETURNS TABLE(user_id uuid, role text, full_name text, avatar_url text, job_title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pm.user_id, pm.role::text AS role, p.full_name, p.avatar_url, p.job_title
  FROM public.project_members pm
  LEFT JOIN public.profiles p ON p.id = pm.user_id
  WHERE pm.project_id = _project
    AND public.is_project_member(_project, auth.uid());
$function$;

-- New-user handler grants all invited projects.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    values (new.id, case when is_first then 'spaceman_admin'::public.app_role else 'client_viewer'::public.app_role end)
    on conflict do nothing;
  end if;

  return new;
end;
$function$;

-- Backfill: every existing Spaceman user becomes a member of every project.
INSERT INTO public.project_members (project_id, user_id, role)
SELECT p.id, ur.user_id, ur.role
FROM public.projects p
CROSS JOIN public.user_roles ur
WHERE ur.role IN ('spaceman_admin','spaceman_developer','spaceman_viewer')
ON CONFLICT (project_id, user_id) DO NOTHING;