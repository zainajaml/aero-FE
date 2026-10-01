-- The project has default privileges that grant new public tables to anon/authenticated.
-- The rate-limit store must be reachable by trusted server code only.
REVOKE ALL ON TABLE public.rate_limit_counters FROM PUBLIC;
REVOKE ALL ON TABLE public.rate_limit_counters FROM anon;
REVOKE ALL ON TABLE public.rate_limit_counters FROM authenticated;
GRANT ALL ON TABLE public.rate_limit_counters TO service_role;