ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'PKT';

ALTER TABLE public.profiles ADD CONSTRAINT profiles_timezone_check CHECK (timezone IN ('PKT','IST','AEST'));