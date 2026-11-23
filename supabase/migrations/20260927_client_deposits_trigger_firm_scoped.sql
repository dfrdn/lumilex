-- trg_client_deposits_apply keeps clients.deposit_balance and clients.receivables
-- in step with client_deposits. Every branch found its client by
--   notion_id = client_id OR (client_id IS NULL AND name = client_name)
-- with no firm condition. Deposits are written through the firm-scoped service
-- client, which bypasses RLS, so a deposit recorded without a client_id moved
-- the balance of every client with that name in every firm on the instance.
-- Each branch now also requires the client to be in the deposit row's own firm.
--
-- Behaviour within a firm is unchanged. The function is SECURITY INVOKER as
-- before; search_path is pinned, which also clears its
-- function_search_path_mutable advisor finding.

create or replace function public.trg_client_deposits_apply()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.type = 'payment' then
      update clients
         set receivables = coalesce(receivables, 0) - new.amount,
             receivables_updated_at = now(),
             receivables_updated_by = new.recorded_by
       where firm_id = new.firm_id
         and (notion_id = new.client_id or (new.client_id is null and name = new.client_name));
    else
      update clients
         set deposit_balance = coalesce(deposit_balance, 0) + new.amount
       where firm_id = new.firm_id
         and (notion_id = new.client_id or (new.client_id is null and name = new.client_name));
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    if old.type = 'payment' then
      update clients
         set receivables = coalesce(receivables, 0) + old.amount,
             receivables_updated_at = now()
       where firm_id = old.firm_id
         and (notion_id = old.client_id or (old.client_id is null and name = old.client_name));
    else
      update clients
         set deposit_balance = coalesce(deposit_balance, 0) - old.amount
       where firm_id = old.firm_id
         and (notion_id = old.client_id or (old.client_id is null and name = old.client_name));
    end if;
    return old;

  elsif tg_op = 'UPDATE' then
    if new.amount    is not distinct from old.amount
       and new.type      is not distinct from old.type
       and new.client_id is not distinct from old.client_id then
      return new;
    end if;

    if old.type = 'payment' then
      update clients
         set receivables = coalesce(receivables, 0) + old.amount,
             receivables_updated_at = now()
       where firm_id = old.firm_id
         and (notion_id = old.client_id or (old.client_id is null and name = old.client_name));
    else
      update clients
         set deposit_balance = coalesce(deposit_balance, 0) - old.amount
       where firm_id = old.firm_id
         and (notion_id = old.client_id or (old.client_id is null and name = old.client_name));
    end if;

    if new.type = 'payment' then
      update clients
         set receivables = coalesce(receivables, 0) - new.amount,
             receivables_updated_at = now(),
             receivables_updated_by = new.recorded_by
       where firm_id = new.firm_id
         and (notion_id = new.client_id or (new.client_id is null and name = new.client_name));
    else
      update clients
         set deposit_balance = coalesce(deposit_balance, 0) + new.amount
       where firm_id = new.firm_id
         and (notion_id = new.client_id or (new.client_id is null and name = new.client_name));
    end if;
    return new;
  end if;
  return null;
end;
$function$;
