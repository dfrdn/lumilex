-- enum_options was the sweep's one manual-review policy: USING (true) let
-- any authenticated principal (portal users included) read every firm's
-- dropdown registry. The registry is per-firm staff configuration: scope
-- reads to active staff of the owning firm.
drop policy if exists enum_options_authenticated_select on public.enum_options;
create policy enum_options_authenticated_select on public.enum_options
  for select to authenticated
  using (firm_id = public.current_firm_id() and public.current_person_id() is not null);
