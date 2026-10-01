INSERT INTO public.email_send_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
