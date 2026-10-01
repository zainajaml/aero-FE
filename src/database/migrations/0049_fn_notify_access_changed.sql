-- Publishes "the access of user X changed" so open sessions can refresh roles immediately
-- (replaces the Supabase realtime subscription on these tables). Payload: the user id.
CREATE OR REPLACE FUNCTION public.notify_access_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _user uuid;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    _user := COALESCE(NEW.id, OLD.id);
  ELSE
    _user := COALESCE(NEW.user_id, OLD.user_id);
  END IF;
  PERFORM pg_notify('access_changed', _user::text);
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_roles_notify_access AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.notify_access_changed();
--> statement-breakpoint
CREATE TRIGGER project_members_notify_access AFTER INSERT OR UPDATE OR DELETE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_access_changed();
--> statement-breakpoint
CREATE TRIGGER account_admins_notify_access AFTER INSERT OR UPDATE OR DELETE ON public.account_admins
  FOR EACH ROW EXECUTE FUNCTION public.notify_access_changed();
--> statement-breakpoint
CREATE TRIGGER profiles_notify_access AFTER UPDATE OF archived_at ON public.profiles
  FOR EACH ROW WHEN (OLD.archived_at IS DISTINCT FROM NEW.archived_at)
  EXECUTE FUNCTION public.notify_access_changed();
