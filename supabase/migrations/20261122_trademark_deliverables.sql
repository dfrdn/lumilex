-- A deliverable can be the paper for one step of a mark's prosecution or
-- upkeep: the application, an Office Action response, a request for
-- extension, a DAU, a renewal, a revival. `trademark_action` names the step
-- by the action that records it (lib/trademarks/actions.ts), and
-- `trademark_office_action_id` the round, for a response or its extension.
-- The mark is the deliverable's `subject_id`.
--
-- The deliverable and the step are one fact, kept equal here rather than in
-- the routes, because either side changes from many places:
-- * a linked deliverable marked "Filed or Sent out" records the step on the
--   mark on its date_done, and a later change of that date moves the step's;
-- * a step recorded on the mark marks its open linked deliverables filed on
--   the step's date, and a corrected date moves their date_done;
-- * Undo on the mark reopens the filed deliverable, at the status it had
--   before it was filed (Outbox when that is unknown);
-- * reopening a filed deliverable undoes the step, under the mark's own Undo
--   rules (lib/trademarks/undo.ts): when a later step rests on it, the
--   reopen is refused with the same message.
-- Every write is skipped when the other side already agrees, so the two
-- triggers settle after one round.
--
-- The functions are SECURITY DEFINER (each side must follow even when the
-- person changing the other may not write it directly), so every read and
-- write is pinned to the changed row's own firm, and EXECUTE is revoked from
-- every API role: only the triggers call them.

ALTER TABLE public.deliverables
  ADD COLUMN IF NOT EXISTS trademark_action text,
  ADD COLUMN IF NOT EXISTS trademark_office_action_id uuid
    REFERENCES public.trademark_office_actions(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deliverables_trademark_action_check') THEN
    ALTER TABLE public.deliverables ADD CONSTRAINT deliverables_trademark_action_check CHECK (
      trademark_action IS NULL OR (
        subject_id IS NOT NULL AND trademark_action IN (
          'mark_as_filed', 'oa_response_filed', 'oa_response_motex', 'revival_filed',
          'dau_3_filed', 'dau_3_motex_filed', 'dau_5_filed',
          'renewal_filed', 'renewal_dau_filed', 'renewal_dau_5_filed'
        )
      )
    );
  END IF;
END $$;

-- One piece of open work per step.
CREATE UNIQUE INDEX IF NOT EXISTS deliverables_open_trademark_step_idx
  ON public.deliverables (
    subject_id, trademark_action,
    COALESCE(trademark_office_action_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE trademark_action IS NOT NULL AND status NOT IN ('Filed or Sent out', 'Archived', 'Acknowledged');

CREATE INDEX IF NOT EXISTS deliverables_subject_idx ON public.deliverables (subject_id) WHERE subject_id IS NOT NULL;

-- ── Mark → deliverable ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.file_trademark_deliverables(text, text, uuid, date);
DROP FUNCTION IF EXISTS public.trademark_step_deliverables_follow(text, text, uuid, boolean, boolean, date);

-- A step on the mark changed: it was or is recorded, on `p_day` (null for a step with no date of its own).
CREATE OR REPLACE FUNCTION public.trademark_step_deliverables_follow(
  p_firm uuid, p_subject text, p_action text, p_oa uuid, p_was boolean, p_is boolean, p_day date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  back text;
  who text := public.current_person_id();
  today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF p_is AND NOT p_was THEN
    FOR r IN
      SELECT notion_id, status FROM public.deliverables
      WHERE firm_id = p_firm AND subject_id = p_subject AND trademark_action = p_action AND trademark_office_action_id IS NOT DISTINCT FROM p_oa
        AND status NOT IN ('Filed or Sent out', 'Archived', 'Acknowledged')
      FOR UPDATE
    LOOP
      UPDATE public.deliverables SET status = 'Filed or Sent out', date_done = COALESCE(p_day, today) WHERE notion_id = r.notion_id;
      IF who IS NOT NULL THEN
        INSERT INTO public.deliverable_actions (firm_id, deliverable_id, action, old_status, new_status, performed_by, comment)
        VALUES (p_firm, r.notion_id, 'Updated Status', r.status, 'Filed or Sent out', who, 'Recorded as filed on the trademark page');
      END IF;
    END LOOP;

  ELSIF p_was AND NOT p_is THEN
    FOR r IN
      SELECT notion_id FROM public.deliverables
      WHERE firm_id = p_firm AND subject_id = p_subject AND trademark_action = p_action AND trademark_office_action_id IS NOT DISTINCT FROM p_oa
        AND status = 'Filed or Sent out'
      FOR UPDATE
    LOOP
      SELECT a.old_status INTO back FROM public.deliverable_actions a
        WHERE a.firm_id = p_firm AND a.deliverable_id = r.notion_id AND a.new_status = 'Filed or Sent out'
        ORDER BY a.created_at DESC LIMIT 1;
      IF back IS NULL OR back IN ('Filed or Sent out', 'Archived', 'Acknowledged') THEN back := 'Outbox'; END IF;
      UPDATE public.deliverables SET status = back, date_done = NULL WHERE notion_id = r.notion_id;
      IF who IS NOT NULL THEN
        INSERT INTO public.deliverable_actions (firm_id, deliverable_id, action, old_status, new_status, performed_by, comment)
        VALUES (p_firm, r.notion_id, 'Updated Status', 'Filed or Sent out', back, who, 'Reopened: the step was undone on the trademark page');
      END IF;
    END LOOP;

  ELSIF p_was AND p_is AND p_day IS NOT NULL THEN
    UPDATE public.deliverables SET date_done = p_day
      WHERE firm_id = p_firm AND subject_id = p_subject AND trademark_action = p_action AND trademark_office_action_id IS NOT DISTINCT FROM p_oa
        AND status = 'Filed or Sent out' AND date_done IS DISTINCT FROM p_day;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.trademark_step_deliverables_follow(uuid, text, text, uuid, boolean, boolean, date) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trademark_steps_file_deliverables()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'trademark_office_actions' THEN
    IF OLD.response_filed_date IS DISTINCT FROM NEW.response_filed_date THEN
      PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.trademark_id, 'oa_response_filed', NEW.id,
        OLD.response_filed_date IS NOT NULL, NEW.response_filed_date IS NOT NULL, NEW.response_filed_date);
    END IF;
    IF OLD.motex IS DISTINCT FROM NEW.motex THEN
      PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.trademark_id, 'oa_response_motex', NEW.id, OLD.motex, NEW.motex, NULL);
    END IF;
    RETURN NULL;
  END IF;

  IF OLD.filing_date IS DISTINCT FROM NEW.filing_date THEN
    PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.id, 'mark_as_filed', NULL, OLD.filing_date IS NOT NULL, NEW.filing_date IS NOT NULL, NEW.filing_date);
  END IF;
  IF OLD.revival_filed_date IS DISTINCT FROM NEW.revival_filed_date THEN
    PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.id, 'revival_filed', NULL, OLD.revival_filed_date IS NOT NULL, NEW.revival_filed_date IS NOT NULL, NEW.revival_filed_date);
  END IF;
  IF OLD.dau_3_filing_date IS DISTINCT FROM NEW.dau_3_filing_date THEN
    PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.id, 'dau_3_filed', NULL, OLD.dau_3_filing_date IS NOT NULL, NEW.dau_3_filing_date IS NOT NULL, NEW.dau_3_filing_date);
  END IF;
  IF OLD.dau_3_motex IS DISTINCT FROM NEW.dau_3_motex THEN
    PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.id, 'dau_3_motex_filed', NULL, OLD.dau_3_motex, NEW.dau_3_motex, NULL);
  END IF;
  IF OLD.dau_5_filing_date IS DISTINCT FROM NEW.dau_5_filing_date THEN
    PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.id, 'dau_5_filed', NULL, OLD.dau_5_filing_date IS NOT NULL, NEW.dau_5_filing_date IS NOT NULL, NEW.dau_5_filing_date);
  END IF;
  IF OLD.renewal_filing_date IS DISTINCT FROM NEW.renewal_filing_date THEN
    PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.id, 'renewal_filed', NULL, OLD.renewal_filing_date IS NOT NULL, NEW.renewal_filing_date IS NOT NULL, NEW.renewal_filing_date);
  END IF;
  IF OLD.renewal_dau_filed_date IS DISTINCT FROM NEW.renewal_dau_filed_date THEN
    PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.id, 'renewal_dau_filed', NULL, OLD.renewal_dau_filed_date IS NOT NULL, NEW.renewal_dau_filed_date IS NOT NULL, NEW.renewal_dau_filed_date);
  END IF;
  IF OLD.renewal_dau_5_filed_date IS DISTINCT FROM NEW.renewal_dau_5_filed_date THEN
    PERFORM public.trademark_step_deliverables_follow(NEW.firm_id, NEW.id, 'renewal_dau_5_filed', NULL, OLD.renewal_dau_5_filed_date IS NOT NULL, NEW.renewal_dau_5_filed_date IS NOT NULL, NEW.renewal_dau_5_filed_date);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_trademarks_file_deliverables ON public.trademarks;
CREATE TRIGGER trg_trademarks_file_deliverables
  AFTER UPDATE ON public.trademarks
  FOR EACH ROW EXECUTE FUNCTION public.trademark_steps_file_deliverables();

DROP TRIGGER IF EXISTS trg_trademark_office_actions_file_deliverables ON public.trademark_office_actions;
CREATE TRIGGER trg_trademark_office_actions_file_deliverables
  AFTER UPDATE ON public.trademark_office_actions
  FOR EACH ROW EXECUTE FUNCTION public.trademark_steps_file_deliverables();

-- ── Deliverable → mark ──────────────────────────────────────────────
-- Recording mirrors /api/trademark/[id]/action and undoing mirrors
-- planUndo, for the steps a deliverable can be.

CREATE OR REPLACE FUNCTION public.deliverable_files_trademark_step()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text := NEW.subject_id;
  oa_id uuid := NEW.trademark_office_action_id;
  d date := COALESCE(NEW.date_done, (now() AT TIME ZONE 'Asia/Manila')::date);
  filed boolean := NEW.status = 'Filed or Sent out';
  reopened boolean := OLD.status = 'Filed or Sent out' AND NEW.status NOT IN ('Filed or Sent out', 'Archived', 'Acknowledged');
  m public.trademarks%ROWTYPE;
  o public.trademark_office_actions%ROWTYPE;
  blocker text;
  open_left boolean;
BEGIN
  IF NOT filed AND NOT reopened THEN RETURN NULL; END IF;
  IF filed AND OLD.status = 'Filed or Sent out' AND OLD.date_done IS NOT DISTINCT FROM NEW.date_done THEN RETURN NULL; END IF;

  SELECT * INTO m FROM public.trademarks WHERE id = t AND firm_id = NEW.firm_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF oa_id IS NOT NULL THEN
    SELECT * INTO o FROM public.trademark_office_actions WHERE id = oa_id AND trademark_id = t AND firm_id = NEW.firm_id FOR UPDATE;
  END IF;

  IF filed THEN
    CASE NEW.trademark_action
      WHEN 'mark_as_filed' THEN
        IF m.origin = 'national' AND m.filing_date IS DISTINCT FROM d THEN
          UPDATE public.trademarks
            SET filing_date = d,
                status = CASE WHEN status IN ('Prelim', 'For Filing') THEN 'Pending' ELSE status END,
                updated_at = now()
            WHERE id = t;
        END IF;
      WHEN 'oa_response_filed' THEN
        IF o.id IS NOT NULL AND o.response_filed_date IS DISTINCT FROM d THEN
          UPDATE public.trademark_office_actions SET response_filed_date = d, updated_at = now() WHERE id = o.id;
          IF o.response_filed_date IS NULL AND m.status IN ('Pending', 'Pending - OA') THEN
            open_left := EXISTS (SELECT 1 FROM public.trademark_office_actions x WHERE x.trademark_id = t AND x.response_filed_date IS NULL);
            UPDATE public.trademarks SET status = CASE WHEN open_left THEN 'Pending - OA' ELSE 'Pending' END, updated_at = now() WHERE id = t;
          END IF;
        END IF;
      WHEN 'oa_response_motex' THEN
        IF o.id IS NOT NULL AND NOT o.motex AND o.response_filed_date IS NULL THEN
          UPDATE public.trademark_office_actions SET motex = true, updated_at = now() WHERE id = o.id;
        END IF;
      WHEN 'revival_filed' THEN
        IF m.revival_filed_date IS NULL THEN
          IF m.status = 'Abandoned' AND m.abandonment_mailing_date IS NOT NULL THEN
            UPDATE public.trademarks
              SET revival_filed_date = d,
                  revival_count = revival_count + 1,
                  status = CASE
                    WHEN status_before_abandonment IS NOT NULL AND status_before_abandonment <> 'Abandoned' THEN status_before_abandonment
                    WHEN reg_date IS NOT NULL THEN 'Registered'
                    WHEN EXISTS (SELECT 1 FROM public.trademark_office_actions x WHERE x.trademark_id = t AND x.response_filed_date IS NULL) THEN 'Pending - OA'
                    ELSE 'Pending' END,
                  updated_at = now()
              WHERE id = t;
          END IF;
        ELSIF m.revival_filed_date IS DISTINCT FROM d THEN
          UPDATE public.trademarks SET revival_filed_date = d, updated_at = now() WHERE id = t;
        END IF;
      WHEN 'dau_3_filed' THEN
        UPDATE public.trademarks SET dau_3_filing_date = d, updated_at = now() WHERE id = t AND dau_3_filing_date IS DISTINCT FROM d;
      WHEN 'dau_3_motex_filed' THEN
        UPDATE public.trademarks SET dau_3_motex = true, updated_at = now() WHERE id = t AND NOT dau_3_motex AND dau_3_filing_date IS NULL;
      WHEN 'dau_5_filed' THEN
        UPDATE public.trademarks SET dau_5_filing_date = d, updated_at = now() WHERE id = t AND dau_5_filing_date IS DISTINCT FROM d;
      WHEN 'renewal_filed' THEN
        UPDATE public.trademarks SET renewal_filing_date = d, updated_at = now() WHERE id = t AND renewal_filing_date IS DISTINCT FROM d;
      WHEN 'renewal_dau_filed' THEN
        UPDATE public.trademarks SET renewal_dau_filed_date = d, updated_at = now() WHERE id = t AND renewal_dau_filed_date IS DISTINCT FROM d;
      WHEN 'renewal_dau_5_filed' THEN
        UPDATE public.trademarks SET renewal_dau_5_filed_date = d, updated_at = now() WHERE id = t AND renewal_dau_5_filed_date IS DISTINCT FROM d;
      ELSE NULL;
    END CASE;
    RETURN NULL;
  END IF;

  -- Reopened: take the step back, if the mark still has it.
  CASE NEW.trademark_action
    WHEN 'mark_as_filed' THEN
      IF m.filing_date IS NULL THEN RETURN NULL; END IF;
      blocker := CASE
        WHEN m.cor_reported_date IS NOT NULL OR m.status = 'Registered' THEN 'registration'
        WHEN m.opposition_filed_date IS NOT NULL THEN 'opposition'
        WHEN m.issuance_fee_paid_date IS NOT NULL THEN 'issuance fee payment'
        WHEN m.issuance_notice_date IS NOT NULL THEN 'Notice of Issuance'
        WHEN m.published_date IS NOT NULL THEN 'publication'
        WHEN m.noi_payment_date IS NOT NULL THEN '1st publication fee payment'
        WHEN m.noi_date IS NOT NULL THEN 'Notice of Allowance'
        WHEN EXISTS (SELECT 1 FROM public.trademark_office_actions x WHERE x.trademark_id = t) THEN 'Office Action'
        WHEN m.dau_3_filing_date IS NOT NULL THEN '3-year DAU'
        WHEN m.dau_3_motex THEN '3-year DAU extension'
      END;
      IF blocker IS NOT NULL THEN
        RAISE EXCEPTION 'Undo the % on the trademark first — it was recorded after the filing.', blocker;
      END IF;
      IF m.status NOT IN ('Pending', 'Pending - OA') THEN
        RAISE EXCEPTION 'The trademark has moved on since the filing, so it can''t be reopened here.';
      END IF;
      UPDATE public.trademarks SET filing_date = NULL, status = 'For Filing', updated_at = now() WHERE id = t;
    WHEN 'oa_response_filed' THEN
      IF o.id IS NULL OR o.response_filed_date IS NULL THEN RETURN NULL; END IF;
      IF m.status = 'Abandoned' THEN
        RAISE EXCEPTION 'Restore the trademark first — it is abandoned.';
      END IF;
      UPDATE public.trademark_office_actions SET response_filed_date = NULL, updated_at = now() WHERE id = o.id;
      IF m.status IN ('Pending', 'Pending - OA') THEN
        UPDATE public.trademarks SET status = 'Pending - OA', updated_at = now() WHERE id = t;
      END IF;
    WHEN 'oa_response_motex' THEN
      IF o.id IS NOT NULL AND o.motex THEN
        UPDATE public.trademark_office_actions SET motex = false, updated_at = now() WHERE id = o.id;
      END IF;
    WHEN 'revival_filed' THEN
      IF m.revival_filed_date IS NULL OR m.status = 'Abandoned' THEN RETURN NULL; END IF;
      UPDATE public.trademarks
        SET status = 'Abandoned', revival_filed_date = NULL, revival_count = GREATEST(0, revival_count - 1), updated_at = now()
        WHERE id = t;
    WHEN 'dau_3_filed' THEN
      UPDATE public.trademarks SET dau_3_filing_date = NULL, updated_at = now() WHERE id = t AND dau_3_filing_date IS NOT NULL;
    WHEN 'dau_3_motex_filed' THEN
      UPDATE public.trademarks SET dau_3_motex = false, updated_at = now() WHERE id = t AND dau_3_motex;
    WHEN 'dau_5_filed' THEN
      UPDATE public.trademarks SET dau_5_filing_date = NULL, updated_at = now() WHERE id = t AND dau_5_filing_date IS NOT NULL;
    WHEN 'renewal_filed' THEN
      IF m.renewal_filing_date IS NULL THEN RETURN NULL; END IF;
      IF m.renewal_dau_5_filed_date IS NOT NULL OR m.renewal_dau_filed_date IS NOT NULL THEN
        RAISE EXCEPTION 'Undo the renewal DAU on the trademark first — it was recorded after the renewal.';
      END IF;
      UPDATE public.trademarks SET renewal_filing_date = NULL, updated_at = now() WHERE id = t;
    WHEN 'renewal_dau_filed' THEN
      UPDATE public.trademarks SET renewal_dau_filed_date = NULL, updated_at = now() WHERE id = t AND renewal_dau_filed_date IS NOT NULL;
    WHEN 'renewal_dau_5_filed' THEN
      UPDATE public.trademarks SET renewal_dau_5_filed_date = NULL, updated_at = now() WHERE id = t AND renewal_dau_5_filed_date IS NOT NULL;
    ELSE NULL;
  END CASE;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_deliverables_file_trademark_step ON public.deliverables;
CREATE TRIGGER trg_deliverables_file_trademark_step
  AFTER UPDATE OF status, date_done ON public.deliverables
  FOR EACH ROW
  WHEN (NEW.trademark_action IS NOT NULL AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.date_done IS DISTINCT FROM NEW.date_done))
  EXECUTE FUNCTION public.deliverable_files_trademark_step();

-- Trigger functions: EXECUTE is checked at CREATE TRIGGER, never when they fire.
REVOKE ALL ON FUNCTION public.trademark_steps_file_deliverables() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deliverable_files_trademark_step() FROM PUBLIC, anon, authenticated, service_role;
