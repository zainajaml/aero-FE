
DROP POLICY IF EXISTS "rate_card_insert_admin" ON public.rate_card;
DROP POLICY IF EXISTS "rate_card_update_admin" ON public.rate_card;
DROP POLICY IF EXISTS "rate_card_delete_admin" ON public.rate_card;

CREATE POLICY "rate_card_insert_admin" ON public.rate_card
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'spaceman_admin') OR public.has_role(auth.uid(), 'client_admin'));

CREATE POLICY "rate_card_update_admin" ON public.rate_card
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'spaceman_admin') OR public.has_role(auth.uid(), 'client_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'spaceman_admin') OR public.has_role(auth.uid(), 'client_admin'));

CREATE POLICY "rate_card_delete_admin" ON public.rate_card
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'spaceman_admin') OR public.has_role(auth.uid(), 'client_admin'));
