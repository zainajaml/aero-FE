-- Tighten the document-images upload policy.
-- Previously any authenticated user (even with no project access) could upload
-- because the policy only checked owner = auth.uid(). Now require that the
-- uploader actually belongs to a project (or is Spaceman staff), is not a
-- view-only user, and can only write into their own user-id folder.

DROP POLICY IF EXISTS "Members can upload document images" ON storage.objects;

CREATE POLICY "Members can upload document images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'document-images'
  AND owner = auth.uid()
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND NOT public.is_viewer(auth.uid())
  AND (
    public.is_spaceman(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid()
    )
  )
);