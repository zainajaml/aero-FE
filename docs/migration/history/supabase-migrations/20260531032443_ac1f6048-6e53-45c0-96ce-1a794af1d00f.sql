-- 1. Restrict profile reads to self, admins, or users who share a project
create or replace function public.shares_project(_other uuid, _user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from project_members pm1
    join project_members pm2 on pm1.project_id = pm2.project_id
    where pm1.user_id = _user and pm2.user_id = _other
  );
$$;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or has_role(auth.uid(), 'admin')
  or public.shares_project(id, auth.uid())
);

-- 2. Restrict attachment file downloads to project members
drop policy if exists "att storage read" on storage.objects;
create policy "att storage read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'attachments'
  and exists (
    select 1
    from public.attachments a
    join public.tickets t on t.id = a.ticket_id
    where a.storage_path = storage.objects.name
      and is_project_member(t.project_id, auth.uid())
  )
);

-- 3. Allow project managers to delete attachment files, matching table policy
drop policy if exists "att storage delete" on storage.objects;
create policy "att storage delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'attachments'
  and (
    owner = auth.uid()
    or exists (
      select 1
      from public.attachments a
      join public.tickets t on t.id = a.ticket_id
      where a.storage_path = storage.objects.name
        and can_manage_project(t.project_id, auth.uid())
    )
  )
);

-- 4. Require project membership to watch a ticket
drop policy if exists "watchers self write" on public.ticket_watchers;
create policy "watchers self write"
on public.ticket_watchers
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.tickets t
    where t.id = ticket_watchers.ticket_id
      and is_project_member(t.project_id, auth.uid())
  )
);

-- 5. Set fixed search_path on the timestamp helper trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin new.updated_at = now(); return new; end;
$function$;