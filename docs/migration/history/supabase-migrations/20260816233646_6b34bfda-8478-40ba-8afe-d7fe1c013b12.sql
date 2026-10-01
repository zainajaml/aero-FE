-- Backfill legacy mixed-case invitation emails to lowercase so casing can never
-- cause duplicate invitations or missed matches. Only pending (unaccepted) and
-- accepted invitation rows are touched; no other user data is modified.
UPDATE public.invitations
SET email = lower(btrim(email))
WHERE email <> lower(btrim(email));

-- Case-insensitive lookup support for invitation email matching.
CREATE INDEX IF NOT EXISTS invitations_email_lower_idx
  ON public.invitations (lower(email));

CREATE INDEX IF NOT EXISTS profiles_email_lower_idx
  ON public.profiles (lower(email));