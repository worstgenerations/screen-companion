
-- roles
CREATE TYPE public.app_role AS ENUM ('admin','user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- shared updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- subscriptions
CREATE TYPE public.account_status AS ENUM ('NONE','TRIALING','ACTIVE','PAST_DUE','PAYMENT_REQUIRED','CANCELLED','EXPIRED','SUSPENDED');

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'stripe',
  customer_id text,
  subscription_id text,
  plan text NOT NULL DEFAULT 'melo_pro',
  currency text NOT NULL DEFAULT 'usd',
  price_cents integer NOT NULL DEFAULT 900,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  subscription_status public.account_status NOT NULL DEFAULT 'NONE',
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  payment_status text NOT NULL DEFAULT 'none',
  payment_method_brand text,
  payment_method_last4 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_subscription_id_idx ON public.subscriptions (subscription_id);
CREATE INDEX subscriptions_customer_id_idx ON public.subscriptions (customer_id);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subscription read" ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- usage
CREATE TABLE public.usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  ai_seconds integer NOT NULL DEFAULT 0,
  interactions integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);
GRANT SELECT ON public.usage_daily TO authenticated;
GRANT ALL ON public.usage_daily TO service_role;
ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own usage read" ON public.usage_daily FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'guidance',
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_user_created_idx ON public.usage_events (user_id, created_at DESC);
GRANT SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events read" ON public.usage_events FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- sessions
CREATE TABLE public.melo_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  goal text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  seconds_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX melo_sessions_user_idx ON public.melo_sessions (user_id, started_at DESC);
GRANT SELECT ON public.melo_sessions TO authenticated;
GRANT ALL ON public.melo_sessions TO service_role;
ALTER TABLE public.melo_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sessions read" ON public.melo_sessions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- config
CREATE TABLE public.app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_config TO authenticated;
GRANT ALL ON public.app_config TO service_role;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read config" ON public.app_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

INSERT INTO public.app_config (key, value) VALUES
  ('trial', '{"days":7,"daily_minutes":15,"daily_interactions":100}'::jsonb),
  ('pro', '{"daily_minutes":60,"monthly_interactions":1500}'::jsonb),
  ('pricing', '{"IN":{"currency":"inr","amount":49900,"label":"₹499/month"},"default":{"currency":"usd","amount":900,"label":"$9/month"}}'::jsonb),
  ('ai', '{"kill_switch":false,"model":"google/gemini-3.8-flash","max_request_bytes":1600000,"rate_limit_per_minute":20,"max_session_minutes":120}'::jsonb),
  ('cost', '{"monthly_usd_cap":250,"alert_threshold_usd":200,"input_per_million":0.3,"output_per_million":2.5}'::jsonb);

-- webhook idempotency
CREATE TABLE public.billing_events (
  id text PRIMARY KEY,
  provider text NOT NULL,
  type text NOT NULL,
  payload jsonb,
  processed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.billing_events TO service_role;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- invoices / payment history
CREATE TABLE public.billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider_invoice_id text UNIQUE,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'paid',
  invoice_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_invoices_user_idx ON public.billing_invoices (user_id, created_at DESC);
GRANT SELECT ON public.billing_invoices TO authenticated;
GRANT ALL ON public.billing_invoices TO service_role;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own invoices read" ON public.billing_invoices FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
