ALTER TABLE public.projects
  ADD COLUMN project_type text NOT NULL DEFAULT 'sprint';

ALTER TABLE public.projects
  ADD CONSTRAINT projects_project_type_check CHECK (project_type IN ('sprint', 'kanban'));

UPDATE public.projects SET project_type = 'sprint';
UPDATE public.projects SET project_type = 'kanban' WHERE name = 'Spaceman';