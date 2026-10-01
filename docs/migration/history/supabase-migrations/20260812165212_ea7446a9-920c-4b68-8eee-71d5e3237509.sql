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

    if inv.role = 'account_admin'::public.app_role then
      insert into public.account_admins (account_id, user_id)
      select distinct p.account_id, new.id
      from public.projects p
      where p.id = any(proj_ids)
        and p.account_id is not null
      on conflict do nothing;
    elsif array_length(proj_ids, 1) is not null then
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
    -- Self-serve signup (no invitation): assign no role so the user is routed
    -- through onboarding, where creating a workspace grants account_admin.
    -- The very first user of a brand-new install still becomes super_admin.
    select count(*) = 0 from public.user_roles into is_first;
    if is_first then
      insert into public.user_roles (user_id, role)
      values (new.id, 'super_admin'::public.app_role)
      on conflict do nothing;
    end if;
  end if;

  return new;
end;
$function$;

-- Clean up placeholder viewer roles for self-serve signups that never joined
-- any account or project, so they can complete onboarding.
DELETE FROM public.user_roles ur
WHERE ur.role = 'viewer'::public.app_role
  AND NOT EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.user_id = ur.user_id)
  AND NOT EXISTS (SELECT 1 FROM public.account_admins aa WHERE aa.user_id = ur.user_id);