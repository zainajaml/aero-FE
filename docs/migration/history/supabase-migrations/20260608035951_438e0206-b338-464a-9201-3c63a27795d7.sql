CREATE TABLE public.document_folders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'New Folder',
  position double precision NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_folders TO authenticated;
GRANT ALL ON public.document_folders TO service_role;

ALTER TABLE public.document_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folders member read" ON public.document_folders
  FOR SELECT USING (is_project_member(project_id, auth.uid()));

CREATE POLICY "folders member write" ON public.document_folders
  FOR INSERT WITH CHECK (
    is_project_member(project_id, auth.uid())
    AND (NOT is_viewer(auth.uid()))
    AND created_by = auth.uid()
  );

CREATE POLICY "folders member update" ON public.document_folders
  FOR UPDATE USING (
    is_project_member(project_id, auth.uid())
    AND (NOT is_viewer(auth.uid()))
  );

CREATE POLICY "folders delete" ON public.document_folders
  FOR DELETE USING (
    created_by = auth.uid() OR can_manage_project(project_id, auth.uid())
  );

CREATE TRIGGER update_document_folders_updated_at
  BEFORE UPDATE ON public.document_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.documents
  ADD COLUMN folder_id uuid REFERENCES public.document_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_documents_folder_id ON public.documents(folder_id);
CREATE INDEX idx_document_folders_project_id ON public.document_folders(project_id);