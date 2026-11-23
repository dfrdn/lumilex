-- Link invoices that never got a client_id, from their matters.
--
-- An invoice's client_id was found by matching its client name to exactly one
-- client record; a name that matched none or several at generation left it
-- NULL, and the client's portal never showed the invoice. Generation now takes
-- the client from the bundle's matters (persistInvoice → resolveInvoiceClientId),
-- and this links any old ones the same way: by the matters filed under the
-- invoice's client name in the invoice's own firm, only where they all name
-- one client.
--
-- Idempotent: only touches rows where client_id IS NULL.

SET LOCAL lumilex.skip_activity = 'on';

WITH matter_clients AS (
  SELECT firm_id, client_name, min(client_id) AS client_id
  FROM public.matters
  WHERE client_id IS NOT NULL
  GROUP BY firm_id, client_name
  HAVING count(DISTINCT client_id) = 1
)
UPDATE public.invoices i
SET client_id = mc.client_id
FROM matter_clients mc
WHERE i.client_id IS NULL
  AND mc.firm_id = i.firm_id
  AND mc.client_name = i.client_name;
