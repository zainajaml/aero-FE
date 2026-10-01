-- P0.3 — minimum necessary EXECUTE privileges on SECURITY DEFINER helpers.
-- No function body, RLS policy, table grant or schema object is changed.
--
-- Rationale:
--  * anon holds no table privileges in the public schema, and every RLS policy
--    targets authenticated (or service_role), so no anonymous flow needs to
--    execute these helpers. Public flows (login, signup, invitation info and
--    acceptance, password reset, Jira OAuth callback, unsubscribe) run through
--    server functions using the service role, not anon RPC.
--  * RLS policy expressions are evaluated as the querying role, so every helper
--    referenced by a public-schema or storage policy must keep authenticated
--    EXECUTE. Helpers only reached from inside another SECURITY DEFINER function
--    run as the definer and do not need a direct grant.
--  * Trigger functions are resolved at trigger-creation time and need no
--    EXECUTE grant to fire.

-- 1. Deny-by-default for every SECURITY DEFINER helper in public.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

-- 2. Re-grant authenticated EXECUTE only where an RLS policy (public schema or
--    storage.objects) or a legitimate browser RPC requires it.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;              -- policies + client RPC
GRANT EXECUTE ON FUNCTION public.is_global_admin(uuid) TO authenticated;                        -- 17 policies
GRANT EXECUTE ON FUNCTION public.is_account_admin(uuid, uuid) TO authenticated;                 -- accounts/account_admins policies
GRANT EXECUTE ON FUNCTION public.can_manage_project(uuid, uuid) TO authenticated;               -- 20 policies + storage
GRANT EXECUTE ON FUNCTION public.can_grant_role(uuid, public.app_role) TO authenticated;        -- user_roles policies
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated;                -- 42 policies + storage + client RPC
GRANT EXECUTE ON FUNCTION public.is_project_viewer(uuid, uuid) TO authenticated;                -- 27 policies + client RPC
GRANT EXECUTE ON FUNCTION public.is_viewer(uuid) TO authenticated;                              -- storage upload policies
GRANT EXECUTE ON FUNCTION public.is_spaceman(uuid) TO authenticated;                            -- storage/profile policies
GRANT EXECUTE ON FUNCTION public.is_spaceman_staff(uuid) TO authenticated;                      -- 4 policies
GRANT EXECUTE ON FUNCTION public.is_archived(uuid) TO authenticated;                            -- 2 policies
GRANT EXECUTE ON FUNCTION public.shares_project(uuid, uuid) TO authenticated;                   -- profiles policies
GRANT EXECUTE ON FUNCTION public.list_visible_profiles(uuid[]) TO authenticated;                -- client RPC (self-authorizing)
GRANT EXECUTE ON FUNCTION public.list_project_accessible_users(uuid) TO authenticated;          -- client RPC (self-authorizing)
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, text, text) TO authenticated;            -- client audit trail
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, text, text, uuid) TO authenticated;      -- client audit trail

-- 3. handle_new_user fires from the auth.users trigger owned by the auth admin.
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- Intentionally left without anon or authenticated EXECUTE:
--   is_client(uuid), current_user_has_any_role(app_role[]),
--   is_account_admin_of_project(uuid, uuid)  -- internal helpers, no policy/RPC caller
--   users_with_activity(uuid[])              -- already service-role only
--   block_project_member_if_account_admin(), enforce_account_admin_exclusive(),
--   guard_project_account_move(), handle_new_user()  -- trigger functions
