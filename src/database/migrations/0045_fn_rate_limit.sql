-- Atomic fixed-window limiter: a rejected call never increments the counter.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  _namespace text,
  _identifier_hash text,
  _window_seconds integer,
  _limit integer,
  _cost integer DEFAULT 1
)
RETURNS TABLE(allowed boolean, request_count integer, reset_at timestamptz)
LANGUAGE plpgsql
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

  RETURN QUERY SELECT (new_count <= _limit), new_count, expires;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.purge_expired_rate_limits()
RETURNS integer
LANGUAGE plpgsql
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
