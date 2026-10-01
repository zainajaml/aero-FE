-- Clear existing global rows; each project begins empty
DELETE FROM public.rate_card;

ALTER TABLE public.rate_card
  ADD COLUMN project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.rate_card DROP CONSTRAINT IF EXISTS rate_card_role_key;
ALTER TABLE public.rate_card ADD CONSTRAINT rate_card_project_role_key UNIQUE (project_id, role);
CREATE INDEX IF NOT EXISTS rate_card_project_idx ON public.rate_card(project_id);

-- Replace policies
DROP POLICY IF EXISTS "Authenticated users can view rate card" ON public.rate_card;
DROP POLICY IF EXISTS "Spaceman admins can delete rate card" ON public.rate_card;
DROP POLICY IF EXISTS "Spaceman admins can insert rate card" ON public.rate_card;
DROP POLICY IF EXISTS "Spaceman admins can update rate card" ON public.rate_card;
DROP POLICY IF EXISTS "rate_card_delete_admin" ON public.rate_card;
DROP POLICY IF EXISTS "rate_card_insert_admin" ON public.rate_card;
DROP POLICY IF EXISTS "rate_card_update_admin" ON public.rate_card;

CREATE POLICY "rate_card_select_project_member" ON public.rate_card
  FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));

CREATE POLICY "rate_card_insert_manager" ON public.rate_card
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project(project_id, auth.uid()));

CREATE POLICY "rate_card_update_manager" ON public.rate_card
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id, auth.uid()))
  WITH CHECK (public.can_manage_project(project_id, auth.uid()));

CREATE POLICY "rate_card_delete_manager" ON public.rate_card
  FOR DELETE TO authenticated
  USING (public.can_manage_project(project_id, auth.uid()));