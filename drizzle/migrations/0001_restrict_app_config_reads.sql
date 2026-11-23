DROP POLICY "authenticated read config" ON public.app_config;
CREATE POLICY "authenticated read product settings" ON public.app_config
  FOR SELECT TO authenticated
  USING (key IN ('product', 'limits'));