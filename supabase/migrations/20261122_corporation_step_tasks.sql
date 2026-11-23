-- A company's registrations are tasks, not deliverables.
--
-- An agency registration is an errand: papers go in and the agency grants it.
-- There is no draft to review, so it sits with the business permit
-- (lib/corporations/permit-task.ts) as a task on the company.
--
-- 1. tasks.subject_id names the company a task is for; tasks.corporation_step
--    the registration it gets done. One open task per registration.
-- 2. Recording the registration on the company closes its open task. It does
--    not work the other way, and clearing a registration date reopens nothing.
-- 3. The business permit tasks already spawned are linked to their company.

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS subject_id text REFERENCES public.subjects(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS corporation_step text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_corporation_step_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_corporation_step_check CHECK (
      corporation_step IS NULL OR (
        subject_id IS NOT NULL AND corporation_step IN (
          'sec_registration', 'bir_registration', 'bir_books', 'bir_atp', 'business_permit', 'sss', 'philhealth', 'pagibig'
        )
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tasks_subject_idx ON public.tasks (subject_id) WHERE subject_id IS NOT NULL;

-- Linking the permit tasks is bookkeeping, not work on their matters, so the
-- activity trigger is told to look away (the flag lasts to the end of the
-- migration's transaction). A task is linked only to a company of its own firm.
DO $$
BEGIN
  PERFORM set_config('lumilex.skip_activity', 'on', true);
  UPDATE public.tasks t
     SET subject_id = c.id, corporation_step = 'business_permit'
    FROM public.corporations c
   WHERE t.notion_id LIKE 'temp-corp-permit-' || c.id || '-%'
     AND c.firm_id = t.firm_id
     AND t.subject_id IS NULL;
  PERFORM set_config('lumilex.skip_activity', 'off', true);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_open_corporation_step_idx
  ON public.tasks (subject_id, corporation_step)
  WHERE corporation_step IS NOT NULL AND NOT done;

-- Closing a step's task is done as the definer, because whoever records a
-- registration on the company need not be on the matter the task hangs off.
-- It is pinned to the company's own firm.
CREATE OR REPLACE FUNCTION public.corporation_step_close_tasks(p_firm uuid, p_subject text, p_step text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.tasks SET done = true, status = 'Done'
  WHERE firm_id = p_firm AND subject_id = p_subject AND corporation_step = p_step AND NOT done;
$$;

REVOKE ALL ON FUNCTION public.corporation_step_close_tasks(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.corporation_steps_close_tasks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.sec_registration_date IS NULL AND NEW.sec_registration_date IS NOT NULL THEN
    PERFORM public.corporation_step_close_tasks(NEW.firm_id, NEW.id, 'sec_registration');
  END IF;
  IF OLD.bir_cor_date IS NULL AND NEW.bir_cor_date IS NOT NULL THEN
    PERFORM public.corporation_step_close_tasks(NEW.firm_id, NEW.id, 'bir_registration');
  END IF;
  IF OLD.bir_books_registration_date IS NULL AND NEW.bir_books_registration_date IS NOT NULL THEN
    PERFORM public.corporation_step_close_tasks(NEW.firm_id, NEW.id, 'bir_books');
  END IF;
  IF OLD.bir_or_authority_date IS NULL AND NEW.bir_or_authority_date IS NOT NULL THEN
    PERFORM public.corporation_step_close_tasks(NEW.firm_id, NEW.id, 'bir_atp');
  END IF;
  -- A permit is issued every year: each new issue, or a first permit number,
  -- closes the open permit task. The route spawns the next renewal after.
  IF (OLD.business_permit_issued_date IS DISTINCT FROM NEW.business_permit_issued_date AND NEW.business_permit_issued_date IS NOT NULL)
     OR (coalesce(btrim(OLD.business_permit_no), '') = '' AND coalesce(btrim(NEW.business_permit_no), '') <> '') THEN
    PERFORM public.corporation_step_close_tasks(NEW.firm_id, NEW.id, 'business_permit');
  END IF;
  IF OLD.sss_registration_date IS NULL AND NEW.sss_registration_date IS NOT NULL THEN
    PERFORM public.corporation_step_close_tasks(NEW.firm_id, NEW.id, 'sss');
  END IF;
  IF OLD.philhealth_registration_date IS NULL AND NEW.philhealth_registration_date IS NOT NULL THEN
    PERFORM public.corporation_step_close_tasks(NEW.firm_id, NEW.id, 'philhealth');
  END IF;
  IF OLD.pagibig_registration_date IS NULL AND NEW.pagibig_registration_date IS NOT NULL THEN
    PERFORM public.corporation_step_close_tasks(NEW.firm_id, NEW.id, 'pagibig');
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.corporation_steps_close_tasks() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_corporation_steps_close_tasks ON public.corporations;
CREATE TRIGGER trg_corporation_steps_close_tasks
  AFTER UPDATE OF sec_registration_date, bir_cor_date, bir_books_registration_date, bir_or_authority_date,
    business_permit_issued_date, business_permit_no, sss_registration_date, philhealth_registration_date, pagibig_registration_date
  ON public.corporations
  FOR EACH ROW EXECUTE FUNCTION public.corporation_steps_close_tasks();
