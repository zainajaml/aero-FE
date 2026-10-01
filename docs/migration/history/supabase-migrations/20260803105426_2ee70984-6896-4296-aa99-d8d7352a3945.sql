DROP POLICY IF EXISTS "Members can read document images" ON storage.objects;

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
      WHERE public.is_project_member(d.project_id, auth.uid())
        AND (
          d.file_path = storage.objects.name
          OR (d.content IS NOT NULL AND d.content::text LIKE '%' || storage.objects.name || '%')
        )
    )
  )
);

DROP POLICY IF EXISTS "stage history member write" ON public.ticket_stage_history;
CREATE POLICY "stage history member write" ON public.ticket_stage_history
FOR INSERT TO authenticated
WITH CHECK (
  public.is_project_member(project_id, auth.uid())
  AND NOT public.is_viewer(auth.uid())
  AND (moved_by = auth.uid() OR moved_by IS NULL)
);