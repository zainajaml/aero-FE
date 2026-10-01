-- 1) Lock down audit_logs: remove direct INSERT, route through a validated SECURITY DEFINER function
DROP POLICY IF EXISTS "audit own insert" ON public.audit_logs;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  _action text,
  _table_name text,
  _field text DEFAULT NULL,
  _value text DEFAULT NULL,
  _link text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF _action NOT IN ('create','read','update','delete') THEN
    RAISE EXCEPTION 'invalid audit action: %', _action;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, table_name, field, value, link)
  VALUES (
    auth.uid(),
    _action,
    left(coalesce(_table_name, ''), 200),
    left(_field, 200),
    left(_value, 2000),
    left(_link, 500)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, text, text) TO authenticated;

-- 2) Prevent client_admin privilege escalation via project_members UPDATE
DROP POLICY IF EXISTS "members pm update" ON public.project_members;
CREATE POLICY "members pm update"
  ON public.project_members
  FOR UPDATE
  TO authenticated
  USING (is_spaceman_staff(auth.uid()))
  WITH CHECK (is_spaceman_staff(auth.uid()));