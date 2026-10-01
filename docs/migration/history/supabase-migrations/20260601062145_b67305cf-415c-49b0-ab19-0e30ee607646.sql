-- ===== Helper functions for the new role model =====
create or replace function public.is_spaceman(_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles
    where user_id=_user and role in ('spaceman_admin','spaceman_developer','spaceman_viewer'));
$$;

create or replace function public.is_spaceman_staff(_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles
    where user_id=_user and role in ('spaceman_admin','spaceman_developer'));
$$;

create or replace function public.is_global_admin(_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles
    where user_id=_user and role='spaceman_admin');
$$;

create or replace function public.is_client(_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles
    where user_id=_user and role in ('client_admin','client_developer','client_viewer'));
$$;

create or replace function public.is_viewer(_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles
    where user_id=_user and role in ('spaceman_viewer','client_viewer'));
$$;

-- ===== Redefine membership / management to use the new model =====
create or replace function public.is_project_member(_project uuid,_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_spaceman(_user)
      or exists(select 1 from public.project_members where project_id=_project and user_id=_user);
$$;

create or replace function public.can_manage_project(_project uuid,_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_spaceman_staff(_user)
      or (exists(select 1 from public.project_members pm
                  where pm.project_id=_project and pm.user_id=_user)
          and exists(select 1 from public.user_roles ur
                  where ur.user_id=_user and ur.role='client_admin'));
$$;

-- ===== Migrate existing user roles to the new values =====
update public.user_roles set role='spaceman_admin'     where role='admin';
update public.user_roles set role='spaceman_developer' where role in ('pm','developer');
update public.user_roles set role='client_viewer'      where role='client';

-- ===== New signups default to least privilege (first user = admin) =====
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare is_first boolean;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  select count(*) = 0 from public.user_roles into is_first;
  insert into public.user_roles (user_id, role)
  values (new.id, case when is_first then 'spaceman_admin'::public.app_role else 'client_viewer'::public.app_role end)
  on conflict do nothing;
  return new;
end;
$$;

-- ===== Profiles: admins + project-sharers can read =====
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_global_admin(auth.uid()) or public.shares_project(id, auth.uid()));

-- ===== Audit logs: global admin only =====
drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs for select to authenticated
using (public.is_global_admin(auth.uid()));

-- ===== User roles: global admin manages =====
drop policy if exists "roles admin delete" on public.user_roles;
create policy "roles admin delete" on public.user_roles for delete to authenticated
using (public.is_global_admin(auth.uid()));
drop policy if exists "roles admin update" on public.user_roles;
create policy "roles admin update" on public.user_roles for update to authenticated
using (public.is_global_admin(auth.uid()));
drop policy if exists "roles admin write" on public.user_roles;
create policy "roles admin write" on public.user_roles for insert to authenticated
with check (public.is_global_admin(auth.uid()));
drop policy if exists "roles self read" on public.user_roles;
create policy "roles self read" on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.is_global_admin(auth.uid()));

-- ===== Invitations: global admin or project manager =====
drop policy if exists "inv read" on public.invitations;
create policy "inv read" on public.invitations for select to authenticated
using (public.is_global_admin(auth.uid()) or (project_id is not null and public.can_manage_project(project_id, auth.uid())));
drop policy if exists "inv write" on public.invitations;
create policy "inv write" on public.invitations for insert to authenticated
with check (public.is_global_admin(auth.uid()) or (project_id is not null and public.can_manage_project(project_id, auth.uid())));
drop policy if exists "inv update" on public.invitations;
create policy "inv update" on public.invitations for update to authenticated
using (public.is_global_admin(auth.uid()) or (project_id is not null and public.can_manage_project(project_id, auth.uid())));
drop policy if exists "inv delete" on public.invitations;
create policy "inv delete" on public.invitations for delete to authenticated
using (public.is_global_admin(auth.uid()) or (project_id is not null and public.can_manage_project(project_id, auth.uid())));

-- ===== Projects: spaceman staff create, global admin delete =====
drop policy if exists "projects admin delete" on public.projects;
create policy "projects admin delete" on public.projects for delete to authenticated
using (public.is_global_admin(auth.uid()));
drop policy if exists "projects pm create" on public.projects;
create policy "projects pm create" on public.projects for insert to authenticated
with check (public.is_spaceman_staff(auth.uid()));

-- ===== Tickets: members write/update unless viewer =====
drop policy if exists "tickets dev write" on public.tickets;
create policy "tickets dev write" on public.tickets for insert to authenticated
with check (public.is_project_member(project_id, auth.uid()) and not public.is_viewer(auth.uid()));
drop policy if exists "tickets dev update" on public.tickets;
create policy "tickets dev update" on public.tickets for update to authenticated
using (public.is_project_member(project_id, auth.uid()) and not public.is_viewer(auth.uid()));

-- ===== Ticket estimates =====
drop policy if exists "est dev write" on public.ticket_estimates;
create policy "est dev write" on public.ticket_estimates for insert to authenticated
with check (exists(select 1 from public.tickets t where t.id=ticket_estimates.ticket_id and public.is_project_member(t.project_id, auth.uid()))
  and not public.is_viewer(auth.uid()));
drop policy if exists "est dev update" on public.ticket_estimates;
create policy "est dev update" on public.ticket_estimates for update to authenticated
using (exists(select 1 from public.tickets t where t.id=ticket_estimates.ticket_id and public.is_project_member(t.project_id, auth.uid()))
  and not public.is_viewer(auth.uid()));
drop policy if exists "est delete" on public.ticket_estimates;
create policy "est delete" on public.ticket_estimates for delete to authenticated
using (
  exists(select 1 from public.tickets t where t.id=ticket_estimates.ticket_id and public.can_manage_project(t.project_id, auth.uid()))
  or (exists(select 1 from public.tickets t where t.id=ticket_estimates.ticket_id and public.is_project_member(t.project_id, auth.uid())) and not public.is_viewer(auth.uid()))
);

-- ===== Attachments table insert =====
drop policy if exists "att dev write" on public.attachments;
create policy "att dev write" on public.attachments for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and exists(select 1 from public.tickets t where t.id=attachments.ticket_id and public.is_project_member(t.project_id, auth.uid()))
  and not public.is_viewer(auth.uid())
);

-- ===== Storage upload: members unless viewer =====
drop policy if exists "att storage upload" on storage.objects;
create policy "att storage upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'attachments'
  and owner = auth.uid()
  and not public.is_viewer(auth.uid())
  and exists(
    select 1 from public.tickets t
    where (t.id)::text = (storage.foldername(objects.name))[1]
      and public.is_project_member(t.project_id, auth.uid())
  )
);