CREATE OR REPLACE FUNCTION public.enforce_account_admin_exclusive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role = 'account_admin' THEN
    -- Only clear project memberships inside the accounts this user administers.
    DELETE FROM public.project_members pm
    USING public.projects p
    WHERE pm.user_id = NEW.user_id
      AND p.id = pm.project_id
      AND p.account_id IN (
        SELECT aa.account_id FROM public.account_admins aa WHERE aa.user_id = NEW.user_id
      );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_project_member_if_account_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.account_admins aa ON aa.account_id = p.account_id
    WHERE p.id = NEW.project_id AND aa.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Account Admins cannot be assigned per-project roles in an account they administer';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  inv public.invitations;
  proj_ids uuid[];
  acct_ids uuid[];
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  -- Apply every pending invitation for this email individually, so no
  -- invitation's grants are lost and none is marked accepted without applying.
  for inv in
    select * from public.invitations
    where lower(email) = lower(new.email)
      and accepted_at is null
    order by created_at
  loop
    insert into public.user_roles (user_id, role)
    values (new.id, inv.role)
    on conflict do nothing;

    proj_ids := coalesce(
      inv.project_ids,
      case when inv.project_id is not null then array[inv.project_id] else '{}'::uuid[] end
    );

    if inv.role = 'account_admin'::public.app_role then
      -- Account access comes from account_ids first; projects are only a fallback.
      acct_ids := coalesce(inv.account_ids, '{}'::uuid[]);
      if array_length(acct_ids, 1) is null and array_length(proj_ids, 1) is not null then
        select array_agg(distinct p.account_id) into acct_ids
        from public.projects p
        where p.id = any(proj_ids) and p.account_id is not null;
      end if;

      if array_length(acct_ids, 1) is not null then
        insert into public.account_admins (account_id, user_id)
        select distinct aid, new.id
        from unnest(acct_ids) as aid
        on conflict do nothing;
      end if;
    elsif array_length(proj_ids, 1) is not null then
      insert into public.project_members (project_id, user_id, role)
      select pid, new.id, inv.role
      from unnest(proj_ids) as pid
      on conflict (project_id, user_id) do nothing;
    end if;

    if inv.job_title is not null then
      update public.profiles set job_title = inv.job_title where id = new.id;
    end if;

    update public.invitations set accepted_at = now() where id = inv.id;
  end loop;

  -- Self-serve signup (no invitation): no role is assigned. The user is routed
  -- through onboarding, where creating an account grants account_admin.
  return new;
end;
$function$;