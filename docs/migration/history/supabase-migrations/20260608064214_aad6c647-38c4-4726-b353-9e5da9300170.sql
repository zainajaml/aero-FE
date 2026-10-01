-- 1. invitations: add a SELECT policy so global admins can list pending
--    invitations and invitees can read their own invitation, with no broad exposure.
CREATE POLICY "inv read"
ON public.invitations
FOR SELECT
TO authenticated
USING (
  is_global_admin(auth.uid())
  OR lower(email) = lower(auth.jwt() ->> 'email')
);

-- 2. profiles: allow project teammates to read each other's profiles.
DROP POLICY IF EXISTS "profiles readable" ON public.profiles;
CREATE POLICY "profiles readable"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR is_spaceman_staff(auth.uid())
  OR shares_project(id, auth.uid())
);

-- 3. support-attachments storage bucket: add an UPDATE policy scoped to the owner's folder.
CREATE POLICY "support attach update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'support-attachments'
  AND (storage.foldername(name))[1] = (auth.uid())::text
)
WITH CHECK (
  bucket_id = 'support-attachments'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);