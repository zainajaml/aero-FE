DROP FUNCTION IF EXISTS public.list_visible_profiles(uuid[]);

CREATE OR REPLACE FUNCTION public.list_visible_profiles(_ids uuid[])
RETURNS TABLE(id uuid, full_name text, avatar_url text, job_title text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p.id, p.full_name, p.avatar_url, p.job_title
  FROM public.profiles p
  WHERE p.id = ANY(_ids)
    AND (
      p.id = auth.uid()
      OR public.is_spaceman(auth.uid())
      OR public.shares_project(p.id, auth.uid())
    )
$function$;

REVOKE EXECUTE ON FUNCTION public.list_visible_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_visible_profiles(uuid[]) TO authenticated;