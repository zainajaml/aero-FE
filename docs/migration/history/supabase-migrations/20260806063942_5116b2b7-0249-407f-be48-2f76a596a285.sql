-- Avatars: restrict reads to self, project/account teammates, and super admins
DROP POLICY IF EXISTS "Avatars readable by authenticated users" ON storage.objects;

CREATE POLICY "Avatars readable by related users"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_spaceman(auth.uid())
    OR public.shares_project(((storage.foldername(name))[1])::uuid, auth.uid())
  )
);

-- Document images: replace fragile filename text-matching with a strict
-- ownership/membership check based on the uploader folder + document join.
DROP POLICY IF EXISTS "Docs file members read" ON storage.objects;

CREATE POLICY "Docs file members read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'document-images'
  AND (
    owner = auth.uid()
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_spaceman(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.file_path = objects.name
        AND public.is_project_member(d.project_id, auth.uid())
    )
    OR public.shares_project(((storage.foldername(name))[1])::uuid, auth.uid())
  )
);