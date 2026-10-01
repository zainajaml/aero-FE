CREATE TABLE public.ticket_estimates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid NOT NULL,
  resource_type text NOT NULL,
  minutes integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_estimates TO authenticated;
GRANT ALL ON public.ticket_estimates TO service_role;

ALTER TABLE public.ticket_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "est read"
ON public.ticket_estimates
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM tickets t
  WHERE t.id = ticket_estimates.ticket_id AND is_project_member(t.project_id, auth.uid())
));

CREATE POLICY "est dev write"
ON public.ticket_estimates
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM tickets t
  WHERE t.id = ticket_estimates.ticket_id
    AND is_project_member(t.project_id, auth.uid())
    AND NOT (EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid() AND pm.role = 'client'::app_role
    ))
));

CREATE POLICY "est dev update"
ON public.ticket_estimates
FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM tickets t
  WHERE t.id = ticket_estimates.ticket_id
    AND is_project_member(t.project_id, auth.uid())
    AND NOT (EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid() AND pm.role = 'client'::app_role
    ))
));

CREATE POLICY "est delete"
ON public.ticket_estimates
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM tickets t
  WHERE t.id = ticket_estimates.ticket_id AND can_manage_project(t.project_id, auth.uid())
) OR EXISTS (
  SELECT 1 FROM tickets t
  WHERE t.id = ticket_estimates.ticket_id
    AND is_project_member(t.project_id, auth.uid())
    AND NOT (EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = t.project_id AND pm.user_id = auth.uid() AND pm.role = 'client'::app_role
    ))
));

CREATE INDEX idx_ticket_estimates_ticket ON public.ticket_estimates(ticket_id);