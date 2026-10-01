-- Account admins hold no per-project seats inside the accounts they administer.
-- SQLSTATE AZ002 is mapped by the backend to a 409 ACCOUNT_ADMIN_PROJECT_ROLE error.
CREATE OR REPLACE FUNCTION public.enforce_account_admin_exclusive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'account_admin' THEN
    DELETE FROM public.project_members pm
    USING public.projects p
    WHERE pm.user_id = NEW.user_id
      AND p.id = pm.project_id
      AND p.account_id IN (SELECT aa.account_id FROM public.account_admins aa WHERE aa.user_id = NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_roles_account_admin_exclusive
  AFTER INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_admin_exclusive();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.block_project_member_if_account_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.account_admins aa ON aa.account_id = p.account_id
    WHERE p.id = NEW.project_id AND aa.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Account Admins cannot be assigned per-project roles in an account they administer'
      USING ERRCODE = 'AZ002';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_members_block_account_admin
  BEFORE INSERT OR UPDATE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.block_project_member_if_account_admin();
