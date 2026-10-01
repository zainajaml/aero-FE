-- 1. Tighten document-images read policy: remove folder-UUID guessing and shares_project paths
DROP POLICY IF EXISTS "Docs file members read" ON storage.objects;
CREATE POLICY "Docs file members read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'document-images'
  AND (
    owner = auth.uid()
    OR public.is_spaceman(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.file_path = objects.name
        AND public.is_project_member(d.project_id, auth.uid())
    )
  )
);

-- 2. Scope project_members management to project managers and restrict assignable roles
DROP POLICY IF EXISTS "members pm manage" ON public.project_members;
DROP POLICY IF EXISTS "members pm update" ON public.project_members;
DROP POLICY IF EXISTS "members pm delete" ON public.project_members;

CREATE POLICY "members pm insert"
ON public.project_members FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_project(project_id, auth.uid())
  AND role IN ('admin'::public.app_role, 'developer'::public.app_role, 'team'::public.app_role, 'viewer'::public.app_role)
);

CREATE POLICY "members pm update"
ON public.project_members FOR UPDATE TO authenticated
USING (public.can_manage_project(project_id, auth.uid()))
WITH CHECK (
  public.can_manage_project(project_id, auth.uid())
  AND role IN ('admin'::public.app_role, 'developer'::public.app_role, 'team'::public.app_role, 'viewer'::public.app_role)
);

CREATE POLICY "members pm delete"
ON public.project_members FOR DELETE TO authenticated
USING (public.can_manage_project(project_id, auth.uid()));