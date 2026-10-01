DROP POLICY IF EXISTS "support_issues update" ON public.support_issues;
CREATE POLICY "support_issues update"
ON public.support_issues
FOR UPDATE
TO authenticated
USING ((user_id = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
WITH CHECK ((user_id = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

REVOKE EXECUTE ON FUNCTION public.users_with_activity(uuid[]) FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.users_with_activity(uuid[]) TO service_role;