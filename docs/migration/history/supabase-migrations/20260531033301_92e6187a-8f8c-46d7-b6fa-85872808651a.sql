UPDATE public.audit_logs
SET action = 'update', table_name = 'sprints', field = 'name', link = '/backlog'
WHERE action = 'Updated sprint';

UPDATE public.audit_logs
SET action = 'update', table_name = 'sprints', field = 'name',
    value = 'Sprint 2', link = '/backlog'
WHERE action = 'Updated sprint Sprint 2';

UPDATE public.audit_logs
SET action = 'update', table_name = 'sprints', field = 'name',
    value = 'Sprint 1', link = '/backlog'
WHERE action = 'Updated sprint Sprint 1';