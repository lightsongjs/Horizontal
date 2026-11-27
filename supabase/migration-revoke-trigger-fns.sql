-- Funcțiile de trigger SECURITY DEFINER nu se cheamă prin /rest/v1/rpc
-- (Postgres le refuză în afara unui trigger), dar aveau EXECUTE pentru
-- anon/authenticated din privilegiile implicite ale Supabase — iar Performance
-- Advisor le raporta. Dreptul nu e verificat la declanșare (doar la CREATE
-- TRIGGER), deci retragerea nu schimbă nimic din comportament.
-- Re-rulabil.

revoke execute on function public.calendar_calendars_disable() from public, anon, authenticated;
revoke execute on function public.saved_filters_unpin() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
