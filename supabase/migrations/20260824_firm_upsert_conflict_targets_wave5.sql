-- Multitenancy phase 5, wave 5: the remaining upsert conflict targets
-- (multitenancy follow-up §5), plus the two globally-unique columns that are a
-- tenancy defect in their own right.
--
-- getServiceDbForFirm rewrites an upsert's onConflict to `firm_id,<cols>`, and
-- Postgres infers a conflict target only from a unique index on exactly that
-- column set. Waves 2–4 covered the targets converted at the time; introspecting
-- for what is left turned up eleven, and three of them are not merely blocked —
-- their call sites are already on the scoped client, so the rewritten target
-- resolves against nothing and the write fails outright with
-- 42P10 "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification":
--
--   email_matter_links        lib/email-linking.ts        (auto-linking emails)
--   matter_exec_summaries     app/api/matter-exec-summary (exec summary save)
--   matter_group_summaries    app/api/matter-group-summary
--
-- The rest are on the authed client today, where no rewrite happens and the
-- global index still serves; the composite is what lets them move.
--
-- As in wave 3, the original global uniques are kept ALONGSIDE: single-firm data
-- satisfies both, and raw-client helpers not yet converted still infer against
-- them. The two exceptions below are where the global unique is the bug.

-- ── Conflict targets ────────────────────────────────────────────────

create unique index if not exists email_matter_links_firm_email_matter_key
  on public.email_matter_links (firm_id, email_id, matter_id);

create unique index if not exists matter_exec_summaries_firm_matter_key
  on public.matter_exec_summaries (firm_id, matter_id);

create unique index if not exists matter_group_summaries_firm_root_matter_key
  on public.matter_group_summaries (firm_id, root_matter_id);

create unique index if not exists matter_billing_configs_firm_matter_key
  on public.matter_billing_configs (firm_id, matter_id);

create unique index if not exists notification_mutes_firm_person_entity_key
  on public.notification_mutes (firm_id, person_id, entity_id);

create unique index if not exists partner_matter_annotations_firm_matter_partner_key
  on public.partner_matter_annotations (firm_id, matter_id, partner_id);

create unique index if not exists push_subscriptions_firm_endpoint_key
  on public.push_subscriptions (firm_id, endpoint);

create unique index if not exists evaluations_firm_period_evaluator_evaluatee_key
  on public.evaluations (firm_id, period_id, evaluator_person_id, evaluatee_person_id);

create unique index if not exists evaluation_scores_firm_evaluation_criterion_key
  on public.evaluation_scores (firm_id, evaluation_id, criterion_key);

create unique index if not exists evaluation_period_other_bonuses_firm_period_person_key
  on public.evaluation_period_other_bonuses (firm_id, period_id, person_id);

create unique index if not exists evaluation_period_discretionary_bonuses_firm_key
  on public.evaluation_period_discretionary_bonuses
    (firm_id, period_id, partner_person_id, associate_person_id);

-- ── user_preferences: the same person in two firms ──────────────────
--
-- The primary key was `email` alone, so one address could hold exactly one
-- preferences row across the whole instance: a lawyer who works at two tenants
-- could not have notification settings at both, and whichever firm wrote second
-- would take the first one's row over. That is a data-model defect, not just a
-- blocked upsert — the row is personal data belonging to a person *at a firm*.
--
-- RLS already reads it that way (`user_preferences_own` is
-- `firm_id = current_firm_id() AND email = current_email()`), so the key is
-- simply catching up with the policy. Nothing references user_preferences by
-- foreign key, and no row can be violated by widening the key.
--
-- scripts/rls-probe.ts asserts the two-firms-one-address case directly.

alter table public.user_preferences drop constraint user_preferences_pkey;
alter table public.user_preferences add constraint user_preferences_pkey primary key (firm_id, email);

-- ── emails.internet_message_id: two firms, one message ──────────────
--
-- The dedup index was a GLOBAL partial unique, so if two tenants were copied on
-- the same message only the first could store it — the second firm's sync would
-- fail on insert with 23505 and drop a client email on the floor. A message id
-- is unique to a message, not to a message *in a firm's mailbox*.
--
-- Here the global index is dropped rather than kept: leaving it in place would
-- preserve exactly the collision the composite exists to remove. The only
-- readers are `lib/email-sync.ts`'s two dedup lookups, both on
-- getServiceDbForFirm, which append `firm_id` — so `.single()` stays
-- single-rowed under the composite. Dropping a unique index cannot violate
-- existing rows.

create unique index if not exists emails_firm_internet_message_id_key
  on public.emails (firm_id, internet_message_id)
  where internet_message_id is not null;

drop index if exists public.idx_emails_internet_message_id;
