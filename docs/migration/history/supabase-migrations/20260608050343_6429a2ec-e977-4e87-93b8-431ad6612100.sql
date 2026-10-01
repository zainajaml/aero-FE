-- Profile detail fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mobile text,
  ADD COLUMN IF NOT EXISTS employee_number text,
  ADD COLUMN IF NOT EXISTS employment_status text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_employment_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_employment_status_check
  CHECK (employment_status IS NULL OR employment_status IN ('full_time','part_time','contract','project'));

-- Time off / sick days
CREATE TABLE IF NOT EXISTS public.time_off (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'holiday',
  start_date date NOT NULL,
  end_date date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_off_kind_check CHECK (kind IN ('holiday','sick','other')),
  CONSTRAINT time_off_date_order CHECK (end_date >= start_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_off TO authenticated;
GRANT ALL ON public.time_off TO service_role;

ALTER TABLE public.time_off ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_off self read" ON public.time_off
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_spaceman_staff(auth.uid()));

CREATE POLICY "time_off self write" ON public.time_off
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "time_off self update" ON public.time_off
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "time_off self delete" ON public.time_off
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER time_off_set_updated_at
  BEFORE UPDATE ON public.time_off
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();