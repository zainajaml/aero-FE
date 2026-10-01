ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

DROP POLICY IF EXISTS "support_messages update own" ON public.support_messages;
CREATE POLICY "support_messages update own"
ON public.support_messages
FOR UPDATE
TO authenticated
USING (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.support_issues si
    WHERE si.id = support_messages.issue_id
      AND si.status = 'open'
      AND (si.user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  )
)
WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.support_issues si
    WHERE si.id = support_messages.issue_id
      AND si.status = 'open'
      AND (si.user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  )
);