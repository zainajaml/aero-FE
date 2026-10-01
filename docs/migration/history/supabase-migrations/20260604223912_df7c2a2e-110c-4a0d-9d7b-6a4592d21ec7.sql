-- Restrict profile reads to owner or spaceman staff (excludes spaceman_viewer)
DROP POLICY IF EXISTS "profiles readable" ON public.profiles;
CREATE POLICY "profiles readable" ON public.profiles
FOR SELECT
TO authenticated
USING ((id = auth.uid()) OR public.is_spaceman_staff(auth.uid()));

-- Restrict project member deletion to spaceman staff only
DROP POLICY IF EXISTS "members pm delete" ON public.project_members;
CREATE POLICY "members pm delete" ON public.project_members
FOR DELETE
TO authenticated
USING (public.is_spaceman_staff(auth.uid()));