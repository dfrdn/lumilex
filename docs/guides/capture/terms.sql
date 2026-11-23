-- Builds the sensitive-term list consumed by anonymize.js.
--
-- Run this READ-ONLY against the production database at capture time and
-- convert the rows to the JSON shape anonymize.js expects:
--
--   window.__ANON_TERMS__ = [ { "v": "<value>", "t": "<type>" }, ... ]
--
-- The output contains real client identifiers. NEVER commit it. Keep it in a
-- temp/scratch location for the duration of the capture session and delete it
-- afterwards. Only this query (which contains no data) lives in the repo.
--
-- Term types map to anonymize.js handling:
--   person    → token-wise Filipino name substitution
--   corp      → token-wise corporate-name substitution
--   matter    → whole-title substitution (plus corp tokens inside it)
--   email     → whole-address substitution
--   trademark → mark-word substitution
--
-- Notes:
-- * Prospects need no separate pull — a prospect IS a client row (status
--   Prospective), so `clients` covers them.
-- * Matter groups are derived from parent matters, so `matters` covers them.
-- * Parties are limited to Ongoing matters to keep the term list a practical
--   size — screenshots are captured on active matters.

SELECT DISTINCT v, t FROM (
  SELECT name AS v, 'corp' AS t FROM clients WHERE name IS NOT NULL

  UNION ALL
  SELECT name, 'matter' FROM matters WHERE name IS NOT NULL

  UNION ALL
  SELECT p.party_name, 'person'
  FROM parties p JOIN matters m ON m.notion_id = p.matter_id
  WHERE p.party_name IS NOT NULL AND m.status = 'Ongoing'

  UNION ALL
  SELECT approved_name, 'corp' FROM corporations WHERE approved_name IS NOT NULL
  UNION ALL
  SELECT unnest(proposed_names), 'corp' FROM corporations WHERE proposed_names IS NOT NULL
  UNION ALL
  SELECT contact_first_name || ' ' || contact_last_name, 'person'
  FROM corporations WHERE contact_first_name IS NOT NULL

  UNION ALL
  SELECT mark, 'trademark' FROM trademarks WHERE mark IS NOT NULL

  UNION ALL
  SELECT name, 'person' FROM client_users WHERE name IS NOT NULL
  UNION ALL
  SELECT email, 'email' FROM client_users WHERE email IS NOT NULL

  UNION ALL
  SELECT name, 'person' FROM directory WHERE name IS NOT NULL
  UNION ALL
  SELECT email_address, 'email' FROM directory WHERE email_address IS NOT NULL
) terms
WHERE length(trim(v)) >= 3
ORDER BY length(v) DESC;
