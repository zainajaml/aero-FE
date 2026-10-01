DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts', 'tickets', 'documents', 'document_folders', 'support_issues', 'time_off',
    'notification_preferences', 'rate_card', 'profile_private', 'jira_connections', 'jira_imports',
    'email_send_state'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
