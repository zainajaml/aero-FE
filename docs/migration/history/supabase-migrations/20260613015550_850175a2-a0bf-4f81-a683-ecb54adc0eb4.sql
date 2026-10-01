-- 1) New private table for sensitive HR fields
CREATE TABLE public.profile_private (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mobile text,
  employee_number text,
  employment_status text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_private_employment_status_check
    CHECK (employment_status IS NULL OR employment_status = ANY (ARRAY['full_time'::text,'part_time'::text,'contract'::text,'project'::text]))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_private TO authenticated;
GRANT ALL ON public.profile_private TO service_role;

ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;

CREATE POLICY "private self or staff read" ON public.profile_private
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_spaceman_staff(auth.uid()));

CREATE POLICY "private self insert" ON public.profile_private
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "private self update" ON public.profile_private
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 2) Migrate existing sensitive data
INSERT INTO public.profile_private (id, mobile, employee_number, employment_status)
SELECT id, mobile, employee_number, employment_status
FROM public.profiles
WHERE mobile IS NOT NULL OR employee_number IS NOT NULL OR employment_status IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- 3) Remove sensitive columns from the shared profile table
ALTER TABLE public.profiles DROP COLUMN mobile;
ALTER TABLE public.profiles DROP COLUMN employee_number;
ALTER TABLE public.profiles DROP COLUMN employment_status;

-- 4) Scope document_folders policies to authenticated role only
ALTER POLICY "folders delete" ON public.document_folders TO authenticated;
ALTER POLICY "folders member read" ON public.document_folders TO authenticated;
ALTER POLICY "folders member update" ON public.document_folders TO authenticated;
ALTER POLICY "folders member write" ON public.document_folders TO authenticated;