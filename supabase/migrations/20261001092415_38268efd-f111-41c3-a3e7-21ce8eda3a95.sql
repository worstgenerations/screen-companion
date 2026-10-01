-- Product configuration (server-controlled, admin-editable)
INSERT INTO public.app_config (key, value) VALUES
  ('product', '{"name": "Melo AI", "plan": "melo_pro", "price_cents": 900, "currency": "usd", "trial_days": 7}'::jsonb),
  ('limits', '{"trial_daily_interactions": 60, "pro_daily_interactions": 500, "trial_daily_ai_seconds": 1800, "pro_daily_ai_seconds": 14400}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Allow any signed-in user to read config (limits/pricing shown in UI)
CREATE POLICY "authenticated read config" ON public.app_config
  FOR SELECT TO authenticated USING (true);

-- Start a 7-day trial automatically for every new user
CREATE OR REPLACE FUNCTION public.handle_new_user_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trial_days int := COALESCE((SELECT (value->>'trial_days')::int FROM public.app_config WHERE key = 'product'), 7);
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, subscription_status, trial_started_at, trial_ends_at)
  VALUES (NEW.id, 'melo_pro', 'TRIALING', now(), now() + make_interval(days => trial_days))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_trial ON auth.users;
CREATE TRIGGER on_auth_user_trial
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_trial();

-- Backfill: give existing users without a subscription a trial starting now
INSERT INTO public.subscriptions (user_id, plan, subscription_status, trial_started_at, trial_ends_at)
SELECT u.id, 'melo_pro', 'TRIALING', now(), now() + interval '7 days'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id);

-- Server-side entitlement check: is this user allowed to use Melo right now?
CREATE OR REPLACE FUNCTION public.melo_entitled(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND (
        s.subscription_status = 'ACTIVE'
        OR (s.subscription_status = 'TRIALING' AND s.trial_ends_at > now())
        OR (s.subscription_status = 'PAST_DUE' AND s.current_period_end > now())
      )
  )
$$;