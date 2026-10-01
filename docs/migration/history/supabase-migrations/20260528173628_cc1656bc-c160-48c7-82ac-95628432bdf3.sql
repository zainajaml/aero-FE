
-- Roles enum + user_roles
create type public.app_role as enum ('admin','pm','developer','client');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  email text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.current_user_has_any_role(_roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = any(_roles)
  )
$$;

-- Auto-create profile on signup; first user becomes admin, others default to developer.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
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
  values (new.id, case when is_first then 'admin'::public.app_role else 'developer'::public.app_role end)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key text not null unique,
  client_account text,
  owner_id uuid references auth.users(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'developer',
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create or replace function public.is_project_member(_project uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.project_members where project_id=_project and user_id=_user)
    or public.has_role(_user,'admin');
$$;

create or replace function public.can_manage_project(_project uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user,'admin')
      or exists (select 1 from public.project_members
                  where project_id=_project and user_id=_user and role in ('admin','pm'));
$$;

-- Sprints, Columns
create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  goal text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'planned', -- planned|active|completed
  capacity_hours numeric default 0,
  created_at timestamptz not null default now()
);

create table public.board_columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  order_index int not null default 0,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);

-- Tickets
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sprint_id uuid references public.sprints(id) on delete set null,
  column_id uuid references public.board_columns(id) on delete set null,
  code text not null,
  title text not null,
  description_json jsonb,
  type text not null default 'task', -- feature|bug|task|chore
  priority text not null default 'medium',
  assignee_id uuid references auth.users(id) on delete set null,
  reporter_id uuid references auth.users(id) on delete set null,
  estimate_minutes int not null default 0,
  position numeric not null default 0,
  released boolean not null default false,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);

create table public.ticket_watchers (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (ticket_id, user_id)
);

create table public.work_logs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  minutes int not null check (minutes > 0),
  note text,
  logged_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  storage_path text not null,
  name text not null,
  mime text,
  size int,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role public.app_role not null,
  project_id uuid references public.projects(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24),'hex'),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Helper trigger to keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger tickets_set_updated_at before update on public.tickets
for each row execute function public.set_updated_at();

-- GRANTS
grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;
grant all on public.profiles to service_role;

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;

grant select, insert, update, delete on public.project_members to authenticated;
grant all on public.project_members to service_role;

grant select, insert, update, delete on public.sprints to authenticated;
grant all on public.sprints to service_role;

grant select, insert, update, delete on public.board_columns to authenticated;
grant all on public.board_columns to service_role;

grant select, insert, update, delete on public.tickets to authenticated;
grant all on public.tickets to service_role;

grant select, insert, update, delete on public.ticket_watchers to authenticated;
grant all on public.ticket_watchers to service_role;

grant select, insert, update, delete on public.work_logs to authenticated;
grant all on public.work_logs to service_role;

grant select, insert, update, delete on public.comments to authenticated;
grant all on public.comments to service_role;

grant select, insert, update, delete on public.attachments to authenticated;
grant all on public.attachments to service_role;

grant select, insert, update, delete on public.invitations to authenticated;
grant all on public.invitations to service_role;

-- RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.sprints enable row level security;
alter table public.board_columns enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_watchers enable row level security;
alter table public.work_logs enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.invitations enable row level security;

-- profiles: any signed-in user can read profiles (for assignees etc.), user updates self
create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "profile self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- user_roles: user reads own; admins read all
create policy "roles self read" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "roles admin write" on public.user_roles for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "roles admin update" on public.user_roles for update to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "roles admin delete" on public.user_roles for delete to authenticated using (public.has_role(auth.uid(),'admin'));

-- projects: members can read; admins/pms (global) can create; project managers can update; admins can delete
create policy "projects member read" on public.projects for select to authenticated
  using (public.is_project_member(id, auth.uid()));
create policy "projects pm create" on public.projects for insert to authenticated
  with check (public.current_user_has_any_role(array['admin','pm']::public.app_role[]));
create policy "projects pm update" on public.projects for update to authenticated
  using (public.can_manage_project(id, auth.uid()));
create policy "projects admin delete" on public.projects for delete to authenticated
  using (public.has_role(auth.uid(),'admin'));

-- project_members
create policy "members project read" on public.project_members for select to authenticated
  using (public.is_project_member(project_id, auth.uid()));
create policy "members pm manage" on public.project_members for insert to authenticated
  with check (public.can_manage_project(project_id, auth.uid()));
create policy "members pm update" on public.project_members for update to authenticated
  using (public.can_manage_project(project_id, auth.uid()));
create policy "members pm delete" on public.project_members for delete to authenticated
  using (public.can_manage_project(project_id, auth.uid()));

-- sprints
create policy "sprints member read" on public.sprints for select to authenticated
  using (public.is_project_member(project_id, auth.uid()));
create policy "sprints pm write" on public.sprints for insert to authenticated
  with check (public.can_manage_project(project_id, auth.uid()));
create policy "sprints pm update" on public.sprints for update to authenticated
  using (public.can_manage_project(project_id, auth.uid()));
create policy "sprints pm delete" on public.sprints for delete to authenticated
  using (public.can_manage_project(project_id, auth.uid()));

-- board_columns
create policy "cols member read" on public.board_columns for select to authenticated
  using (public.is_project_member(project_id, auth.uid()));
create policy "cols pm write" on public.board_columns for insert to authenticated
  with check (public.can_manage_project(project_id, auth.uid()));
create policy "cols pm update" on public.board_columns for update to authenticated
  using (public.can_manage_project(project_id, auth.uid()));
create policy "cols pm delete" on public.board_columns for delete to authenticated
  using (public.can_manage_project(project_id, auth.uid()));

-- tickets — clients read-only, dev/pm/admin write
create policy "tickets member read" on public.tickets for select to authenticated
  using (public.is_project_member(project_id, auth.uid()));
create policy "tickets dev write" on public.tickets for insert to authenticated
  with check (public.is_project_member(project_id, auth.uid())
              and not exists (select 1 from public.project_members
                              where project_id = tickets.project_id and user_id = auth.uid() and role = 'client'));
create policy "tickets dev update" on public.tickets for update to authenticated
  using (public.is_project_member(project_id, auth.uid())
         and not exists (select 1 from public.project_members
                         where project_id = tickets.project_id and user_id = auth.uid() and role = 'client'));
create policy "tickets pm delete" on public.tickets for delete to authenticated
  using (public.can_manage_project(project_id, auth.uid()));

-- watchers
create policy "watchers read" on public.ticket_watchers for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id and public.is_project_member(t.project_id, auth.uid())));
create policy "watchers self write" on public.ticket_watchers for insert to authenticated
  with check (user_id = auth.uid());
create policy "watchers self delete" on public.ticket_watchers for delete to authenticated
  using (user_id = auth.uid());

-- work_logs: members read; owner writes own; pms update/delete
create policy "wlogs read" on public.work_logs for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id and public.is_project_member(t.project_id, auth.uid())));
create policy "wlogs own write" on public.work_logs for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.tickets t where t.id = ticket_id and public.is_project_member(t.project_id, auth.uid())));
create policy "wlogs own update" on public.work_logs for update to authenticated
  using (user_id = auth.uid());
create policy "wlogs own delete" on public.work_logs for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.tickets t where t.id = ticket_id and public.can_manage_project(t.project_id, auth.uid())));

-- comments: members (including clients) read and write own
create policy "comments read" on public.comments for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id and public.is_project_member(t.project_id, auth.uid())));
create policy "comments own write" on public.comments for insert to authenticated
  with check (author_id = auth.uid()
              and exists (select 1 from public.tickets t where t.id = ticket_id and public.is_project_member(t.project_id, auth.uid())));
create policy "comments own update" on public.comments for update to authenticated
  using (author_id = auth.uid());
create policy "comments own delete" on public.comments for delete to authenticated
  using (author_id = auth.uid() or exists (select 1 from public.tickets t where t.id = ticket_id and public.can_manage_project(t.project_id, auth.uid())));

-- attachments: members read; non-client members write; uploader/pm delete
create policy "att read" on public.attachments for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id and public.is_project_member(t.project_id, auth.uid())));
create policy "att dev write" on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid()
              and exists (select 1 from public.tickets t where t.id = ticket_id and public.is_project_member(t.project_id, auth.uid())
                          and not exists (select 1 from public.project_members pm where pm.project_id = t.project_id and pm.user_id = auth.uid() and pm.role = 'client')));
create policy "att delete" on public.attachments for delete to authenticated
  using (uploaded_by = auth.uid() or exists (select 1 from public.tickets t where t.id = ticket_id and public.can_manage_project(t.project_id, auth.uid())));

-- invitations: admins/pms manage
create policy "inv admin read" on public.invitations for select to authenticated
  using (public.current_user_has_any_role(array['admin','pm']::public.app_role[]));
create policy "inv admin write" on public.invitations for insert to authenticated
  with check (public.current_user_has_any_role(array['admin','pm']::public.app_role[]));
create policy "inv admin update" on public.invitations for update to authenticated
  using (public.current_user_has_any_role(array['admin','pm']::public.app_role[]));
create policy "inv admin delete" on public.invitations for delete to authenticated
  using (public.current_user_has_any_role(array['admin','pm']::public.app_role[]));

-- Storage bucket for attachments
insert into storage.buckets (id, name, public) values ('attachments','attachments', false)
on conflict (id) do nothing;

create policy "att storage read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments');
create policy "att storage upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and owner = auth.uid());
create policy "att storage delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
