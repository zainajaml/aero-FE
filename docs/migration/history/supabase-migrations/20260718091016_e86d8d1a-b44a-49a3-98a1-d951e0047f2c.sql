CREATE OR REPLACE FUNCTION public.shares_project(_other uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    -- both are direct project members of the same project
    SELECT 1
    FROM project_members pm1
    JOIN project_members pm2 ON pm1.project_id = pm2.project_id
    WHERE pm1.user_id = _user AND pm2.user_id = _other
  ) OR EXISTS (
    -- _user is account admin of an account that _other is a member of (or vice versa)
    SELECT 1
    FROM account_admins aa
    JOIN projects p ON p.account_id = aa.account_id
    JOIN project_members pm ON pm.project_id = p.id
    WHERE (aa.user_id = _user AND pm.user_id = _other)
       OR (aa.user_id = _other AND pm.user_id = _user)
  ) OR EXISTS (
    -- both are account admins of the same account
    SELECT 1
    FROM account_admins a1
    JOIN account_admins a2 ON a1.account_id = a2.account_id
    WHERE a1.user_id = _user AND a2.user_id = _other
  );
$function$;