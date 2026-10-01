-- 1) Tighten invitations write policies.
-- All invitation creation/revocation in the app goes through service-role
-- server functions (admin.server.ts), so client_admin users do not need a
-- direct client-side write path. Restricting writes to global admins removes
-- the path that bypasses server-side validation.

DROP POLICY IF EXISTS "inv write" ON public.invitations;
DROP POLICY IF EXISTS "inv update" ON public.invitations;
DROP POLICY IF EXISTS "inv delete" ON public.invitations;

CREATE POLICY "inv write"
ON public.invitations
FOR INSERT
TO authenticated
WITH CHECK (is_global_admin(auth.uid()));

CREATE POLICY "inv update"
ON public.invitations
FOR UPDATE
TO authenticated
USING (is_global_admin(auth.uid()));

CREATE POLICY "inv delete"
ON public.invitations
FOR DELETE
TO authenticated
USING (is_global_admin(auth.uid()));

-- 2) Add an explicit UPDATE policy for the attachments storage bucket,
-- mirroring the existing DELETE policy, so the policy set is complete and
-- updates are governed by ownership / project-management rules.

DROP POLICY IF EXISTS "att storage update" ON storage.objects;

CREATE POLICY "att storage update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  (bucket_id = 'attachments'::text) AND (
    (owner = auth.uid()) OR (EXISTS (
      SELECT 1
      FROM (public.attachments a
        JOIN public.tickets t ON (t.id = a.ticket_id))
      WHERE ((a.storage_path = objects.name) AND can_manage_project(t.project_id, auth.uid()))
    ))
  )
)
WITH CHECK (
  (bucket_id = 'attachments'::text) AND (
    (owner = auth.uid()) OR (EXISTS (
      SELECT 1
      FROM (public.attachments a
        JOIN public.tickets t ON (t.id = a.ticket_id))
      WHERE ((a.storage_path = objects.name) AND can_manage_project(t.project_id, auth.uid()))
    ))
  )
);