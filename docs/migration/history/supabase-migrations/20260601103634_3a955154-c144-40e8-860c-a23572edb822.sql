CREATE TABLE public.documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  parent_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled',
  icon text,
  content jsonb,
  position numeric NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_project ON public.documents(project_id);
CREATE INDEX idx_documents_parent ON public.documents(parent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs member read"
ON public.documents FOR SELECT TO authenticated
USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "docs member write"
ON public.documents FOR INSERT TO authenticated
WITH CHECK (is_project_member(project_id, auth.uid()) AND (NOT is_viewer(auth.uid())) AND created_by = auth.uid());

CREATE POLICY "docs member update"
ON public.documents FOR UPDATE TO authenticated
USING (is_project_member(project_id, auth.uid()) AND (NOT is_viewer(auth.uid())));

CREATE POLICY "docs delete"
ON public.documents FOR DELETE TO authenticated
USING ((created_by = auth.uid()) OR can_manage_project(project_id, auth.uid()));

CREATE TRIGGER documents_set_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();