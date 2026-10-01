ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS job_title text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_first boolean;
  inv public.invitations;
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

    if inv.project_id is not null then
      insert into public.project_members (project_id, user_id, role)
      values (inv.project_id, new.id, inv.role)
      on conflict do nothing;
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