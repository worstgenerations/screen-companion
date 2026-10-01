REVOKE EXECUTE ON FUNCTION public.melo_entitled(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_trial() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.melo_entitled(uuid) TO service_role;