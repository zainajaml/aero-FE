-- 1 & 2: Scope invitations policies to project managers of the relevant project
DROP POLICY IF EXISTS "inv admin read" ON public.invitations;
DROP POLICY IF EXISTS "inv admin update" ON public.invitations;
DROP POLICY IF EXISTS "inv admin delete" ON public.invitations;
DROP POLICY IF EXISTS "inv admin write" ON public.invitations;

CREATE POLICY "inv read"
ON public.invitations
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (project_id IS NOT NULL AND can_manage_project(project_id, auth.uid()))
);

CREATE POLICY "inv write"
ON public.invitations
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (project_id IS NOT NULL AND can_manage_project(project_id, auth.uid()))
);

CREATE POLICY "inv update"
ON public.invitations
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (project_id IS NOT NULL AND can_manage_project(project_id, auth.uid()))
);

CREATE POLICY "inv delete"
ON public.invitations
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (project_id IS NOT NULL AND can_manage_project(project_id, auth.uid()))
);

-- 3: Require project membership for attachment uploads (path begins with ticket_id)
DROP POLICY IF EXISTS "att storage upload" ON storage.objects;

CREATE POLICY "att storage upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'attachments'
  AND owner = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id::text = (storage.foldername(name))[1]
      AND is_project_member(t.project_id, auth.uid())
      AND NOT EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = t.project_id
          AND pm.user_id = auth.uid()
          AND pm.role = 'client'::app_role
      )
  )
);