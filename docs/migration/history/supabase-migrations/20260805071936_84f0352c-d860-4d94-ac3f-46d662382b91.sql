DROP POLICY IF EXISTS "Docs file members read" ON storage.objects;

CREATE POLICY "Docs file members read"
ON storage.objects
FOR SELECT
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
    OR EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE public.is_project_member(t.project_id, auth.uid())
        AND t.description_json IS NOT NULL
        AND t.description_json::text LIKE '%' || storage.objects.name || '%'
    )
    OR EXISTS (
      SELECT 1 FROM public.comments c
      JOIN public.tickets t ON t.id = c.ticket_id
      WHERE public.is_project_member(t.project_id, auth.uid())
        AND c.body IS NOT NULL
        AND c.body LIKE '%' || storage.objects.name || '%'
    )
    OR EXISTS (
      SELECT 1 FROM public.work_logs w
      JOIN public.tickets t ON t.id = w.ticket_id
      WHERE public.is_project_member(t.project_id, auth.uid())
        AND w.note IS NOT NULL
        AND w.note LIKE '%' || storage.objects.name || '%'
    )
  )
);