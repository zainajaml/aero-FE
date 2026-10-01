DO $$
DECLARE bad text[] := ARRAY['pm','client','client_admin','client_developer','spaceman_developer','spaceman_viewer'];
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role::text = ANY(bad))
     OR EXISTS (SELECT 1 FROM public.project_members WHERE role::text = ANY(bad))
     OR EXISTS (SELECT 1 FROM public.invitations WHERE role::text = ANY(bad)) THEN
    RAISE EXCEPTION 'legacy roles still in use';
  END IF;
END $$;

DROP POLICY IF EXISTS "audit project admin read" ON public.audit_logs;
DROP POLICY IF EXISTS "support_issues read" ON public.support_issues;
DROP POLICY IF EXISTS "support_issues update" ON public.support_issues;
DROP POLICY IF EXISTS "support_issues delete" ON public.support_issues;
DROP POLICY IF EXISTS "support_messages read" ON public.support_messages;
DROP POLICY IF EXISTS "support_messages insert" ON public.support_messages;
DROP POLICY IF EXISTS "support_messages update own" ON public.support_messages;
DROP POLICY IF EXISTS "support_messages delete" ON public.support_messages;
DROP POLICY IF EXISTS "support attach read" ON storage.objects;

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.current_user_has_any_role(public.app_role[]);

ALTER TYPE public.app_role RENAME TO app_role_legacy;
CREATE TYPE public.app_role AS ENUM ('super_admin','account_admin','admin','developer','team','viewer');

ALTER TABLE public.project_members ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.user_roles      ALTER COLUMN role TYPE public.app_role USING role::text::public.app_role;
ALTER TABLE public.project_members ALTER COLUMN role TYPE public.app_role USING role::text::public.app_role;
ALTER TABLE public.invitations     ALTER COLUMN role TYPE public.app_role USING role::text::public.app_role;
ALTER TABLE public.project_members ALTER COLUMN role SET DEFAULT 'developer'::public.app_role;

DROP TYPE public.app_role_legacy;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

CREATE OR REPLACE FUNCTION public.current_user_has_any_role(_roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role = any(_roles)) $$;

CREATE POLICY "audit project admin read" ON public.audit_logs FOR SELECT TO authenticated
USING (project_id IS NOT NULL AND public.has_role(auth.uid(), 'admin') AND public.is_project_member(project_id, auth.uid()));

CREATE POLICY "support_issues read" ON public.support_issues FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "support_issues update" ON public.support_issues FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "support_issues delete" ON public.support_issues FOR DELETE TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "support_messages read" ON public.support_messages FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.support_issues si WHERE si.id = support_messages.issue_id AND (si.user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'))));

CREATE POLICY "support_messages insert" ON public.support_messages FOR INSERT TO authenticated
WITH CHECK (author_id = auth.uid() AND EXISTS (SELECT 1 FROM public.support_issues si WHERE si.id = support_messages.issue_id AND (si.user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'))));

CREATE POLICY "support_messages update own" ON public.support_messages FOR UPDATE TO authenticated
USING (author_id = auth.uid() AND EXISTS (SELECT 1 FROM public.support_issues si WHERE si.id = support_messages.issue_id AND si.status = 'open' AND (si.user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'))))
WITH CHECK (author_id = auth.uid() AND EXISTS (SELECT 1 FROM public.support_issues si WHERE si.id = support_messages.issue_id AND si.status = 'open' AND (si.user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'))));

CREATE POLICY "support_messages delete" ON public.support_messages FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.support_issues si WHERE si.id = support_messages.issue_id AND (si.user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'))));

CREATE POLICY "support attach read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'support-attachments' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(), 'super_admin')));