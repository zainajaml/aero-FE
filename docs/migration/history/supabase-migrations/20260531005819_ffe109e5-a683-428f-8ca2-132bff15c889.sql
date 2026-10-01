CREATE TABLE public.ticket_stage_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL,
  project_id UUID NOT NULL,
  column_id UUID,
  column_name TEXT NOT NULL,
  entered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  moved_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_tsh_ticket ON public.ticket_stage_history (ticket_id, entered_at);
CREATE INDEX idx_tsh_project ON public.ticket_stage_history (project_id);

GRANT SELECT, INSERT ON public.ticket_stage_history TO authenticated;
GRANT ALL ON public.ticket_stage_history TO service_role;

ALTER TABLE public.ticket_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stage history member read"
ON public.ticket_stage_history
FOR SELECT
TO authenticated
USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "stage history member write"
ON public.ticket_stage_history
FOR INSERT
TO authenticated
WITH CHECK (
  is_project_member(project_id, auth.uid())
  AND (moved_by = auth.uid() OR moved_by IS NULL)
);

-- Backfill: one row per existing ticket with its current (or first) board column.
INSERT INTO public.ticket_stage_history (ticket_id, project_id, column_id, column_name, entered_at)
SELECT
  t.id,
  t.project_id,
  c.id,
  COALESCE(c.name, 'Backlog'),
  t.created_at
FROM public.tickets t
LEFT JOIN LATERAL (
  SELECT bc.id, bc.name
  FROM public.board_columns bc
  WHERE bc.project_id = t.project_id
    AND (
      bc.id = t.column_id
      OR (t.column_id IS NULL AND bc.order_index = (
        SELECT MIN(order_index) FROM public.board_columns WHERE project_id = t.project_id
      ))
    )
  LIMIT 1
) c ON TRUE;