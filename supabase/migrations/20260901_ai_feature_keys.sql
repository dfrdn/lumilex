-- ── AI features become opt-in, per firm ──────────────────────────────
--
-- Four new feature keys covering every path that sends firm content to a
-- third-party model:
--
--   ai_analysis     Claude reads stored matter and client documents.
--   ai_search       Voyage embeds firm content; vectors are stored and queried.
--   ai_assistant    The staff assistant and matter chat.
--   ai_client_chat  AI answering the firm's clients in the portal.
--
-- They are separate keys because they are separate consents — a firm that is
-- happy for its lawyers to use AI has not thereby agreed that its *clients*
-- will be answered by one, and analysis (a one-shot read) is not the same
-- disclosure as embedding (a durable derived copy at a second subprocessor).
--
-- Registration only. Every row is written DISABLED, following the rule the
-- provisioning engine already holds: `firms.settings.features` is the
-- entitlement and this row is the switch, and both must be on. So this
-- migration turns AI OFF everywhere, which is the intended effect of making it
-- opt-in — an operator turns each key on per firm from /platform/firms/[id].
--
-- Idempotent: `on conflict do nothing` never re-disables a key an operator has
-- already switched on. Re-running must not undo somebody's decision.

insert into public.firm_integrations (firm_id, feature, enabled, config)
select f.id, k.feature, false, '{}'::jsonb
  from public.firms f
 cross join (values
   ('ai_analysis'),
   ('ai_search'),
   ('ai_assistant'),
   ('ai_client_chat')
 ) as k(feature)
on conflict (firm_id, feature) do nothing;
