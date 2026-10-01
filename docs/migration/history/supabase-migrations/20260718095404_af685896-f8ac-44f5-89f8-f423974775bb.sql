ALTER TABLE public.rate_card ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.rate_card DROP CONSTRAINT IF EXISTS rate_card_project_role_key;
CREATE UNIQUE INDEX IF NOT EXISTS rate_card_project_role_location_key ON public.rate_card (project_id, role, COALESCE(location, ''));