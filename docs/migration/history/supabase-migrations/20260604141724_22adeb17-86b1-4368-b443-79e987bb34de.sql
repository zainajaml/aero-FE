-- Epics: reusable tags per project
CREATE TABLE public.epics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  name text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX epics_project_name_unique ON public.epics (project_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.epics TO authenticated;
GRANT ALL ON public.epics TO service_role;

ALTER TABLE public.epics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "epics member read" ON public.epics
  FOR SELECT TO authenticated
  USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "epics dev write" ON public.epics
  FOR INSERT TO authenticated
  WITH CHECK (is_project_member(project_id, auth.uid()) AND (NOT is_viewer(auth.uid())) AND created_by = auth.uid());

CREATE POLICY "epics pm delete" ON public.epics
  FOR DELETE TO authenticated
  USING (can_manage_project(project_id, auth.uid()));

-- Join table: tickets <-> epics
CREATE TABLE public.ticket_epics (
  ticket_id uuid NOT NULL,
  epic_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, epic_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_epics TO authenticated;
GRANT ALL ON public.ticket_epics TO service_role;

ALTER TABLE public.ticket_epics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_epics read" ON public.ticket_epics
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_epics.ticket_id AND is_project_member(t.project_id, auth.uid())));

CREATE POLICY "ticket_epics dev write" ON public.ticket_epics
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_epics.ticket_id AND is_project_member(t.project_id, auth.uid()) AND (NOT is_viewer(auth.uid()))));

CREATE POLICY "ticket_epics dev delete" ON public.ticket_epics
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_epics.ticket_id AND is_project_member(t.project_id, auth.uid()) AND (NOT is_viewer(auth.uid()))));