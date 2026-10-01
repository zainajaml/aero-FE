CREATE POLICY "Authenticated users can read document images"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'document-images');