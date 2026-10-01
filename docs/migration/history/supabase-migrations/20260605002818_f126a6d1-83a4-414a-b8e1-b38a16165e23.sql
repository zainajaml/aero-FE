ALTER TABLE public.sprints ADD COLUMN IF NOT EXISTS position double precision NOT NULL DEFAULT 0;

UPDATE public.sprints SET position = -EXTRACT(EPOCH FROM created_at);