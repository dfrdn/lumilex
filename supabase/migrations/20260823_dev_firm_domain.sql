-- Host → firm resolution needs a row per hostname a firm answers on.
-- Unauthenticated surfaces (the public intake form) have no session, so Host
-- is their only tenancy signal and they reject unmapped hosts. Seed the dev
-- firm's local hostnames; real deployments add their own rows at provisioning.
insert into public.firm_domains (domain, firm_id, is_primary)
values ('localhost', '00000000-0000-4000-8000-000000000001', true)
on conflict (domain) do nothing;

insert into public.firm_domains (domain, firm_id, is_primary)
values ('127.0.0.1', '00000000-0000-4000-8000-000000000001', false)
on conflict (domain) do nothing;
