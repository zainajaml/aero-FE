CREATE TABLE public.rate_card (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL UNIQUE,
  hourly_rate numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_card TO authenticated;
GRANT ALL ON public.rate_card TO service_role;

ALTER TABLE public.rate_card ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view rate card"
  ON public.rate_card FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Spaceman admins can insert rate card"
  ON public.rate_card FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'spaceman_admin'));

CREATE POLICY "Spaceman admins can update rate card"
  ON public.rate_card FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'spaceman_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'spaceman_admin'));

CREATE POLICY "Spaceman admins can delete rate card"
  ON public.rate_card FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'spaceman_admin'));

CREATE TRIGGER set_rate_card_updated_at
  BEFORE UPDATE ON public.rate_card
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed with the resource types used across the app
INSERT INTO public.rate_card (role, hourly_rate) VALUES
  ('AI Engineer', 0),
  ('Backend', 0),
  ('Business Analysis', 0),
  ('Design', 0),
  ('DevOps', 0),
  ('Frontend', 0),
  ('Full-stack', 0),
  ('Project Management', 0),
  ('QA', 0),
  ('Solution Architect', 0),
  ('Other', 0)
ON CONFLICT (role) DO NOTHING;
