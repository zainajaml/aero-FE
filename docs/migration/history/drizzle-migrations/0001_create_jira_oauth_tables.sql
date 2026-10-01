CREATE TABLE public.jira_connections (
  user_id uuid PRIMARY KEY,
  cloud_id text NOT NULL,
  site_url text,
  site_name text,
  account_email text,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz NOT NULL,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.jira_connections TO service_role;
ALTER TABLE public.jira_connections ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated grants: tokens are only ever read by server code
-- through the service-role client. Clients get status via server functions.

CREATE TABLE public.jira_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  redirect_to text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.jira_oauth_states TO service_role;
ALTER TABLE public.jira_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER jira_connections_set_updated_at
BEFORE UPDATE ON public.jira_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
