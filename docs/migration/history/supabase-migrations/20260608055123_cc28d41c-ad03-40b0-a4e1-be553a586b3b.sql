ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS project_id uuid;

CREATE OR REPLACE FUNCTION public.log_audit_event(_action text, _table_name text, _field text DEFAULT NULL::text, _value text DEFAULT NULL::text, _link text DEFAULT NULL::text, _project_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF _action NOT IN ('create','read','update','delete') THEN
    RAISE EXCEPTION 'invalid audit action: %', _action;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, table_name, field, value, link, project_id)
  VALUES (
    auth.uid(),
    _action,
    left(coalesce(_table_name, ''), 200),
    left(_field, 200),
    left(_value, 2000),
    left(_link, 500),
    _project_id
  );
END;
$function$;