-- Add a user-facing message column to the email send log so notifications
-- can display the message that triggered them (e.g. a comment mention body).
ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS message text;