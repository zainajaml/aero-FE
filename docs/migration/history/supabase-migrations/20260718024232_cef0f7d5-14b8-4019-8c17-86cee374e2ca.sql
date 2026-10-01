
-- Accounts
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.account_admins (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);
GRANT SELECT ON public.account_admins TO authenticated;
GRANT ALL ON public.account_admins TO service_role;
ALTER TABLE public.account_admins ENABLE ROW LEVEL SECURITY;

-- Project account link
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT;

-- Seed accounts and assign existing projects
INSERT INTO public.accounts (name, slug) VALUES ('VisionRecap', 'visionrecap') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.accounts (name, slug) VALUES ('Spaceman', 'spaceman') ON CONFLICT (name) DO NOTHING;

UPDATE public.projects
   SET account_id = (SELECT id FROM public.accounts WHERE slug = 'visionrecap')
 WHERE key = 'VRA';

UPDATE public.projects
   SET account_id = (SELECT id FROM public.accounts WHERE slug = 'spaceman')
 WHERE account_id IS NULL;

ALTER TABLE public.projects ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS projects_account_id_idx ON public.projects(account_id);

-- Helper functions
CREATE OR REPLACE FUNCTION public.is_account_admin(_user uuid, _account uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.account_admins WHERE account_id = _account AND user_id = _user);
$$;

CREATE OR REPLACE FUNCTION public.is_account_admin_of_project(_project uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.account_admins aa ON aa.account_id = p.account_id
    WHERE p.id = _project AND aa.user_id = _user
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(_project uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_global_admin(_user)
      OR public.is_account_admin_of_project(_project, _user)
      OR EXISTS(
        SELECT 1 FROM public.project_members pm
        JOIN public.user_roles ur ON ur.user_id = pm.user_id
        WHERE pm.project_id = _project AND pm.user_id = _user AND ur.role = 'admin'
      );
$$;

-- Migrate Jaime-Lee to account_admin of VisionRecap
DO $$
DECLARE jl_id uuid; va_id uuid;
BEGIN
  SELECT id INTO jl_id FROM public.profiles WHERE lower(email) = 'jl@visionrepartners.com' LIMIT 1;
  SELECT id INTO va_id FROM public.accounts WHERE slug = 'visionrecap' LIMIT 1;
  IF jl_id IS NOT NULL AND va_id IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = jl_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (jl_id, 'account_admin'::public.app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.account_admins (account_id, user_id) VALUES (va_id, jl_id)
      ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Accounts policies
DROP POLICY IF EXISTS "accounts read" ON public.accounts;
CREATE POLICY "accounts read" ON public.accounts
FOR SELECT TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.is_account_admin(auth.uid(), id)
  OR EXISTS (SELECT 1 FROM public.projects p
             JOIN public.project_members pm ON pm.project_id = p.id
             WHERE p.account_id = accounts.id AND pm.user_id = auth.uid())
);

DROP POLICY IF EXISTS "accounts super admin insert" ON public.accounts;
CREATE POLICY "accounts super admin insert" ON public.accounts
FOR INSERT TO authenticated WITH CHECK (public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS "accounts super admin update" ON public.accounts;
CREATE POLICY "accounts super admin update" ON public.accounts
FOR UPDATE TO authenticated
USING (public.is_global_admin(auth.uid()))
WITH CHECK (public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS "accounts super admin delete" ON public.accounts;
CREATE POLICY "accounts super admin delete" ON public.accounts
FOR DELETE TO authenticated
USING (public.is_global_admin(auth.uid()));

-- account_admins policies
DROP POLICY IF EXISTS "account_admins read" ON public.account_admins;
CREATE POLICY "account_admins read" ON public.account_admins
FOR SELECT TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR user_id = auth.uid()
  OR public.is_account_admin(auth.uid(), account_id)
);

DROP POLICY IF EXISTS "account_admins super admin insert" ON public.account_admins;
CREATE POLICY "account_admins super admin insert" ON public.account_admins
FOR INSERT TO authenticated WITH CHECK (public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS "account_admins super admin delete" ON public.account_admins;
CREATE POLICY "account_admins super admin delete" ON public.account_admins
FOR DELETE TO authenticated USING (public.is_global_admin(auth.uid()));

-- Broaden project write policies for account admins
DROP POLICY IF EXISTS "projects pm create" ON public.projects;
CREATE POLICY "projects pm create" ON public.projects
FOR INSERT TO authenticated
WITH CHECK (
  public.is_spaceman_staff(auth.uid())
  OR public.is_account_admin(auth.uid(), account_id)
);

DROP POLICY IF EXISTS "projects admin delete" ON public.projects;
CREATE POLICY "projects admin delete" ON public.projects
FOR DELETE TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR public.is_account_admin(auth.uid(), account_id)
);

-- Updated-at trigger for accounts
DROP TRIGGER IF EXISTS accounts_set_updated_at ON public.accounts;
CREATE TRIGGER accounts_set_updated_at
BEFORE UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
