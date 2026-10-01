-- Provisional (imported, not yet invited) user marker
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_provisional boolean NOT NULL DEFAULT false;

-- Jira reference identifiers for future sync
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS jira_cloud_id text,
  ADD COLUMN IF NOT EXISTS jira_project_id text,
  ADD COLUMN IF NOT EXISTS jira_project_key text;
CREATE UNIQUE INDEX IF NOT EXISTS projects_jira_ref_unique
  ON public.projects (account_id, jira_cloud_id, jira_project_id)
  WHERE jira_project_id IS NOT NULL;

ALTER TABLE public.sprints ADD COLUMN IF NOT EXISTS jira_sprint_id text;
CREATE UNIQUE INDEX IF NOT EXISTS sprints_jira_ref_unique
  ON public.sprints (project_id, jira_sprint_id) WHERE jira_sprint_id IS NOT NULL;

ALTER TABLE public.epics ADD COLUMN IF NOT EXISTS jira_issue_key text;
CREATE UNIQUE INDEX IF NOT EXISTS epics_jira_ref_unique
  ON public.epics (project_id, jira_issue_key) WHERE jira_issue_key IS NOT NULL;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS jira_issue_id text,
  ADD COLUMN IF NOT EXISTS jira_issue_key text;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_jira_ref_unique
  ON public.tickets (project_id, jira_issue_id) WHERE jira_issue_id IS NOT NULL;

ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS jira_comment_id text;
CREATE UNIQUE INDEX IF NOT EXISTS comments_jira_ref_unique
  ON public.comments (ticket_id, jira_comment_id) WHERE jira_comment_id IS NOT NULL;

ALTER TABLE public.work_logs ADD COLUMN IF NOT EXISTS jira_worklog_id text;
CREATE UNIQUE INDEX IF NOT EXISTS work_logs_jira_ref_unique
  ON public.work_logs (ticket_id, jira_worklog_id) WHERE jira_worklog_id IS NOT NULL;

ALTER TABLE public.attachments ADD COLUMN IF NOT EXISTS jira_attachment_id text;
CREATE UNIQUE INDEX IF NOT EXISTS attachments_jira_ref_unique
  ON public.attachments (ticket_id, jira_attachment_id) WHERE jira_attachment_id IS NOT NULL;

-- Import run state (drives the 3-step wizard progress)
CREATE TABLE IF NOT EXISTS public.jira_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  cloud_id text NOT NULL,
  jira_project_id text NOT NULL,
  jira_project_key text NOT NULL,
  jira_project_name text NOT NULL,
  project_type text NOT NULL DEFAULT 'kanban',
  phase text NOT NULL DEFAULT 'setup',
  page_token text,
  processed_issues integer NOT NULL DEFAULT 0,
  total_issues integer NOT NULL DEFAULT 0,
  imported_comments integer NOT NULL DEFAULT 0,
  imported_worklogs integer NOT NULL DEFAULT 0,
  imported_attachments integer NOT NULL DEFAULT 0,
  sprint_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_users jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.jira_imports TO authenticated;
GRANT ALL ON public.jira_imports TO service_role;

ALTER TABLE public.jira_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own Jira imports" ON public.jira_imports;
CREATE POLICY "Users read their own Jira imports"
ON public.jira_imports FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS jira_imports_user_idx ON public.jira_imports (user_id, created_at DESC);
