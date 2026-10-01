ALTER TABLE public.ticket_estimates
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS estimated_at timestamp with time zone NOT NULL DEFAULT now();