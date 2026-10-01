-- P0.4 Durable rate limiting: one shared counter table + one atomic consume function.
-- Only trusted server code (service_role) may touch it; browser clients have no access.

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  namespace text NOT NULL,
  identifier_hash text NOT NULL,
  window_seconds integer NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, identifier_hash, window_seconds, window_start)
);

COMMENT ON TABLE public.rate_limit_counters IS
  'Durable fixed-window rate-limit counters. identifier_hash is a SHA-256 digest - never a raw token, email or IP. Server-only (service_role); no client access.';

CREATE INDEX IF NOT EXISTS rate_limit_counters_expires_at_idx
  ON public.rate_limit_counters (expires_at);

GRANT ALL ON public.rate_limit_counters TO service_role;

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: anon and authenticated can never read or write.

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  _namespace text,
  _identifier_hash text,
  _window_seconds integer,
  _limit integer,
  _cost integer DEFAULT 1
)
RETURNS TABLE(allowed boolean, request_count integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket timestamptz;
  expires timestamptz;
  new_count integer;
  existing integer;
BEGIN
  IF _window_seconds IS NULL OR _window_seconds <= 0 THEN
    RAISE EXCEPTION 'window_seconds must be positive';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _cost IS NULL OR _cost <= 0 THEN
    RAISE EXCEPTION 'limit and cost must be positive';
  END IF;

  bucket := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / _window_seconds) * _window_seconds);
  expires := bucket + make_interval(secs => _window_seconds);

  -- Atomic: a single INSERT .. ON CONFLICT DO UPDATE. The conditional WHERE means
  -- concurrent callers can never push the counter past the limit, and a rejected
  -- call does not increment the counter.
  INSERT INTO public.rate_limit_counters AS c
    (namespace, identifier_hash, window_seconds, window_start, request_count, expires_at)
  VALUES (_namespace, _identifier_hash, _window_seconds, bucket, _cost, expires)
  ON CONFLICT (namespace, identifier_hash, window_seconds, window_start)
  DO UPDATE SET request_count = c.request_count + _cost, updated_at = now()
    WHERE c.request_count + _cost <= _limit
  RETURNING c.request_count INTO new_count;

  IF new_count IS NULL THEN
    SELECT r.request_count INTO existing
      FROM public.rate_limit_counters r
     WHERE r.namespace = _namespace
       AND r.identifier_hash = _identifier_hash
       AND r.window_seconds = _window_seconds
       AND r.window_start = bucket;
    RETURN QUERY SELECT false, COALESCE(existing, _limit), expires;
    RETURN;
  END IF;

  -- Opportunistic bounded cleanup keeps the table from growing indefinitely.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_counters r
     WHERE r.expires_at < now() - interval '1 hour';
  END IF;

  RETURN QUERY SELECT (new_count <= _limit), new_count, expires;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, text, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, text, integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, text, integer, integer, integer) TO service_role;

-- Manual/scheduled sweep, in addition to the opportunistic cleanup above.
CREATE OR REPLACE FUNCTION public.purge_expired_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.rate_limit_counters r WHERE r.expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_rate_limits() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_rate_limits() FROM anon;
REVOKE ALL ON FUNCTION public.purge_expired_rate_limits() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_rate_limits() TO service_role;