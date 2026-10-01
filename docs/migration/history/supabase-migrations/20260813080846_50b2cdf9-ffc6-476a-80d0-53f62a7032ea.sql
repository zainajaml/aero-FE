CREATE POLICY "accounts account admin update"
ON public.accounts
FOR UPDATE
TO authenticated
USING (public.is_account_admin(auth.uid(), id))
WITH CHECK (public.is_account_admin(auth.uid(), id));