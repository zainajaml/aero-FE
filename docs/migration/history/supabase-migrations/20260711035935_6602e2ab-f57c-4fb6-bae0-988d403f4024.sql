-- Add a unique six-character alphanumeric ticket number to support tickets
ALTER TABLE public.support_issues
  ADD COLUMN IF NOT EXISTS ticket_number text;

-- Function to generate a random 6-char uppercase alphanumeric code
CREATE OR REPLACE FUNCTION public.generate_support_ticket_number()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  candidate text;
  i int;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..6 LOOP
      candidate := candidate || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.support_issues WHERE ticket_number = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

-- Trigger to assign a ticket number on insert when not provided
CREATE OR REPLACE FUNCTION public.set_support_ticket_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := public.generate_support_ticket_number();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_support_ticket_number ON public.support_issues;
CREATE TRIGGER trg_set_support_ticket_number
  BEFORE INSERT ON public.support_issues
  FOR EACH ROW EXECUTE FUNCTION public.set_support_ticket_number();

-- Backfill existing rows
UPDATE public.support_issues
SET ticket_number = public.generate_support_ticket_number()
WHERE ticket_number IS NULL OR ticket_number = '';

-- Enforce uniqueness and presence going forward
ALTER TABLE public.support_issues
  ALTER COLUMN ticket_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS support_issues_ticket_number_key
  ON public.support_issues (ticket_number);