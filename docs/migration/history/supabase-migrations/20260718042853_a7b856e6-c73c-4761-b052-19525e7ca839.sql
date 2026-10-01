
-- Enforce: users with the account_admin role cannot also be project_members.
-- Their access is derived from account_admins, so any per-project role would
-- represent a conflicting seat.

-- 1. Clean up existing conflicting rows.
DELETE FROM public.project_members pm
USING public.user_roles ur
WHERE pm.user_id = ur.user_id AND ur.role = 'account_admin';

-- 2. Trigger to strip project memberships when a user becomes account_admin.
CREATE OR REPLACE FUNCTION public.enforce_account_admin_exclusive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'account_admin' THEN
    DELETE FROM public.project_members WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_account_admin_exclusive ON public.user_roles;
CREATE TRIGGER user_roles_account_admin_exclusive
AFTER INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_admin_exclusive();

-- 3. Trigger to block adding a project membership for an account_admin user.
CREATE OR REPLACE FUNCTION public.block_project_member_if_account_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.user_id AND role = 'account_admin'
  ) THEN
    RAISE EXCEPTION 'Account Admins cannot be assigned per-project roles';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_members_block_account_admin ON public.project_members;
CREATE TRIGGER project_members_block_account_admin
BEFORE INSERT OR UPDATE ON public.project_members
FOR EACH ROW EXECUTE FUNCTION public.block_project_member_if_account_admin();
