ALTER TABLE public.jira_imports
  ADD COLUMN IF NOT EXISTS jira_users jsonb NOT NULL DEFAULT '[]'::jsonb;