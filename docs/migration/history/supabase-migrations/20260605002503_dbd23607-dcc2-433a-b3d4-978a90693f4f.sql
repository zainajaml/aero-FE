CREATE POLICY "support_issues delete" ON public.support_issues
  FOR DELETE
  TO authenticated
  USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'spaceman_admin'::app_role));

CREATE POLICY "support_messages delete" ON public.support_messages
  FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.support_issues si
    WHERE si.id = support_messages.issue_id
      AND ((si.user_id = auth.uid()) OR has_role(auth.uid(), 'spaceman_admin'::app_role))
  ));