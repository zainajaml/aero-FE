ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT 'description',
  ADD COLUMN IF NOT EXISTS comment_id uuid REFERENCES public.comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_attachments_comment_id ON public.attachments(comment_id);