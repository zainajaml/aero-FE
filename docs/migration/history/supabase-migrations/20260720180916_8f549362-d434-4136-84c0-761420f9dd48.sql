
-- 1) tickets insert policy: align with update policy, allow any non-viewer project member
--    (this includes account_admin via is_project_member) and remove hardcoded role list.
DROP POLICY IF EXISTS "tickets dev write" ON public.tickets;
CREATE POLICY "tickets dev write" ON public.tickets
FOR INSERT TO authenticated
WITH CHECK (
  public.is_project_member(project_id, auth.uid())
  AND NOT public.is_viewer(auth.uid())
);

-- 2) user_roles account_admin read: scope reads to users who belong to projects
--    in accounts the caller administers, instead of granting read on every row.
DROP POLICY IF EXISTS "roles account admin read" ON public.user_roles;
CREATE POLICY "roles account admin read" ON public.user_roles
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.account_admins aa
    JOIN public.projects p ON p.account_id = aa.account_id
    JOIN public.project_members pm ON pm.project_id = p.id
    WHERE aa.user_id = auth.uid()
      AND pm.user_id = user_roles.user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.account_admins aa2
    WHERE aa2.user_id = auth.uid()
      AND aa2.user_id = user_roles.user_id
  )
);

-- 3) document-images storage: add explicit policies that join to public.documents
--    via file_path so project members can read attached document files, and only
--    project managers can update/delete them.
DROP POLICY IF EXISTS "Docs file members read" ON storage.objects;
CREATE POLICY "Docs file members read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'document-images'
  AND (
    owner = auth.uid()
    OR public.is_spaceman(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.file_path = storage.objects.name
        AND public.is_project_member(d.project_id, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Docs file managers update" ON storage.objects;
CREATE POLICY "Docs file managers update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'document-images'
  AND (
    owner = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.file_path = storage.objects.name
        AND public.can_manage_project(d.project_id, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Docs file managers delete" ON storage.objects;
CREATE POLICY "Docs file managers delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'document-images'
  AND (
    owner = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.file_path = storage.objects.name
        AND public.can_manage_project(d.project_id, auth.uid())
    )
  )
);

-- Members can still read the existing inline image policy path; the new policies
-- ADD project-member read access for document file attachments (documents.file_path).
