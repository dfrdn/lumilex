-- The Notice of Allowance and the Notice of Issuance are two notices, not one.
--
-- Allowance (noi_date / noi_received_date) approves publication for
-- opposition. For applications filed on or after 14 Feb 2023 nothing is due
-- on it — the 1st publication fee went with the filing fee — though the
-- issuance and 2nd publication fees may be paid in advance. For earlier
-- filings the 1st publication fee is due within 2 months; noi_payment_date
-- now records only that payment.
--
-- With no opposition within 30 days of publication, IPOPHL sends the Notice
-- of Issuance (issuance_notice_date, the date on the document, and
-- issuance_notice_received_date) asking for the issuance and 2nd publication
-- fees (issuance_fee_paid_date — earlier than the notice when paid in
-- advance), then issues the COR and publishes the registration.

ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS issuance_notice_date date;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS issuance_notice_received_date date;
ALTER TABLE public.trademarks ADD COLUMN IF NOT EXISTS issuance_fee_paid_date date;

-- On a filing from 14 Feb 2023 the payment recorded after the "NOI" was the
-- issuance and 2nd publication fees, paid in advance of the COR.
UPDATE public.trademarks
   SET issuance_fee_paid_date = noi_payment_date,
       noi_payment_date = NULL
 WHERE noi_payment_date IS NOT NULL
   AND issuance_fee_paid_date IS NULL
   AND filing_date >= DATE '2023-02-14';

ALTER TABLE public.trademark_files DROP CONSTRAINT IF EXISTS trademark_files_step_check;
ALTER TABLE public.trademark_files ADD CONSTRAINT trademark_files_step_check CHECK (
  step IS NULL OR step = ANY (ARRAY[
    'filing', 'office_action', 'oa_response', 'oa_motex', 'noi', 'noi_payment',
    'publication', 'opposition', 'issuance', 'issuance_payment', 'cor', 'abandonment', 'revival',
    'dau_3', 'dau_3_motex', 'dau_5', 'renewal', 'renewal_dau', 'renewal_dau_5'
  ])
);

-- Papers filed under the old payment step on those marks move with it.
UPDATE public.trademark_files f
   SET step = 'issuance_payment'
  FROM public.trademarks t
 WHERE f.trademark_id = t.id
   AND f.step = 'noi_payment'
   AND t.filing_date >= DATE '2023-02-14';
