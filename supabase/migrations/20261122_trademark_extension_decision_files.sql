-- IPOPHL's order granting or denying a request for extension is filed under
-- its own step: on the Office Action round, or on the 3-year DAU.

ALTER TABLE public.trademark_files DROP CONSTRAINT IF EXISTS trademark_files_step_check;
ALTER TABLE public.trademark_files ADD CONSTRAINT trademark_files_step_check CHECK (
  step IS NULL OR step = ANY (ARRAY[
    'filing', 'office_action', 'oa_response', 'oa_motex', 'oa_motex_decision', 'noi', 'noi_payment',
    'publication', 'opposition', 'issuance', 'issuance_payment', 'cor', 'abandonment', 'revival',
    'dau_3', 'dau_3_motex', 'dau_3_motex_decision', 'dau_5', 'renewal', 'renewal_dau', 'renewal_dau_5'
  ])
);
