-- 1) Restrict document-images storage reads to the owner, users who share a
--    project with the uploader, or Spaceman staff. Previously ANY authenticated
--    user could read every project's document images.
DROP POLICY IF EXISTS "Authenticated users can read document images" ON storage.objects;

CREATE POLICY "Members can read document images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'document-images'
  AND (
    owner = auth.uid()
    OR public.is_spaceman(auth.uid())
    OR public.shares_project(((storage.foldername(name))[1])::uuid, auth.uid())
  )
);

-- 2) Invitations contain plaintext invite tokens and emails. All invitation
--    workflows (create, list, accept) run server-side through the service-role
--    client, which bypasses RLS. No client code reads this table directly, so
--    remove direct authenticated SELECT access to keep tokens service-role only.
DROP POLICY IF EXISTS "inv read" ON public.invitations;