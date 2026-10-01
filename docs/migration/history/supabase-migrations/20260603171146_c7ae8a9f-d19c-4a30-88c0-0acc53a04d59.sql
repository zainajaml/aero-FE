CREATE TABLE public.support_issues (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_issues TO authenticated;
GRANT ALL ON public.support_issues TO service_role;

ALTER TABLE public.support_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_issues read" ON public.support_issues
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'spaceman_admin'));

CREATE POLICY "support_issues insert" ON public.support_issues
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "support_issues update" ON public.support_issues
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'spaceman_admin'));

CREATE TRIGGER set_support_issues_updated_at
  BEFORE UPDATE ON public.support_issues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.support_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_id uuid NOT NULL REFERENCES public.support_issues(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_messages read" ON public.support_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.support_issues si
    WHERE si.id = support_messages.issue_id
      AND (si.user_id = auth.uid() OR public.has_role(auth.uid(), 'spaceman_admin'))
  ));

CREATE POLICY "support_messages insert" ON public.support_messages
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.support_issues si
    WHERE si.id = support_messages.issue_id
      AND (si.user_id = auth.uid() OR public.has_role(auth.uid(), 'spaceman_admin'))
  ));