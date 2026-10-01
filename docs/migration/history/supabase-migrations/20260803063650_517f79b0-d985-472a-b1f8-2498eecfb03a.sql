CREATE OR REPLACE FUNCTION public.users_with_activity(_ids uuid[])
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.id
  FROM unnest(_ids) AS u(id)
  WHERE EXISTS (SELECT 1 FROM public.work_logs t WHERE t.user_id = u.id)
     OR EXISTS (SELECT 1 FROM public.comments t WHERE t.author_id = u.id)
     OR EXISTS (SELECT 1 FROM public.support_messages t WHERE t.author_id = u.id)
     OR EXISTS (SELECT 1 FROM public.audit_logs t WHERE t.user_id = u.id)
     OR EXISTS (SELECT 1 FROM public.attachments t WHERE t.uploaded_by = u.id)
     OR EXISTS (SELECT 1 FROM public.ticket_stage_history t WHERE t.moved_by = u.id)
     OR EXISTS (SELECT 1 FROM public.documents t WHERE t.created_by = u.id)
     OR EXISTS (SELECT 1 FROM public.epics t WHERE t.created_by = u.id)
     OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.reporter_id = u.id OR t.assignee_id = u.id);
$$;

REVOKE ALL ON FUNCTION public.users_with_activity(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.users_with_activity(uuid[]) TO service_role;