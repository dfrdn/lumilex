import type { LetterParagraph } from '@/lib/docx/letter-body';
import type { LetterPlaceholder } from '@/lib/letter-placeholders';
import { FIELD_RE, wordingProblem as sharedWordingProblem } from '@/lib/letter-wording';
import { fillWording, wordingToParagraphs as sharedWordingToParagraphs } from '@/lib/client-reports/wording';

/**
 * The standard wording of the trademark client reports, editable on
 * Trademarks → Report wording. Each report has a letter body and an email
 * message; a few blocks are shared by several reports. What is saved in
 * `trademark_report_wording` replaces the default here, block by block.
 *
 * Wording uses the engine every editable letter shares — lib/letter-wording.ts
 * to fill and check it, lib/letter-markup.ts and components/LetterEditor.tsx
 * to edit it: `{{field}}` the report fills in,
 * `**bold**` and `*italic*`, a blank line between paragraphs, a line starting
 * "- " for a numbered item, and `[[ … ]]` around words that drop out when a
 * field inside them is blank. A block field (`{{proofOfUse}}`, …) stands alone
 * as its own paragraph and brings in a shared block or a list. The dates are
 * never typed: every one is a field the app computes, so an edit can change
 * the words but not get a deadline wrong.
 */

/** Who may change the reports' standard wording: lawyers send these reports, so they keep it too; every change is kept as a revision. */
export const REPORT_WORDING_EDIT_ROLES = ['lawyer', 'partner', 'admin', 'super_user'];

export const WORDING_FIELDS: LetterPlaceholder[] = [
  { key: 'mark', label: 'Mark', meaning: 'the mark in quotation marks, e.g. “SAMPLE MARK”' },
  { key: 'applicant', label: 'Applicant', meaning: 'the applicant (the mark’s owner, else the client)' },
  { key: 'applicationNo', label: 'Application no.', meaning: 'the application or registration number IPOPHL issued; blank when none' },
  { key: 'filingDate', label: 'Filing date', meaning: 'the filing date of the application' },
  { key: 'eventDate', label: 'Step date', meaning: 'the day of the step the report is about' },
  { key: 'receivedDate', label: 'Received on', meaning: 'the day the firm received the Office Action or notice; blank when not recorded' },
  { key: 'annexes', label: 'Annexes', meaning: 'the sentence naming what is attached, e.g. “A copy of the Office Action is attached as Annex “A”.”; blank when nothing is attached' },
  { key: 'annexCopies', label: 'Annex copies', meaning: '“a copy of the Office Action”, or “copies of …” for several papers; blank when nothing is attached' },
  { key: 'oaName', label: 'Office Action', meaning: 'the round, e.g. “Office Action (Registrability Report)” or “final rejection”' },
  { key: 'oaDate', label: 'Office Action date', meaning: 'the mailing date on the Office Action' },
  { key: 'responseWhat', label: 'Response kind', meaning: '“response to”, or “appeal from, or compliance with,” for a final rejection' },
  { key: 'responseDue', label: 'Response due', meaning: 'the last day to answer the Office Action' },
  { key: 'responseExtendedDue', label: 'Response, extended', meaning: 'the last day with the 2-month extension; blank when the examiner set the period' },
  { key: 'examinerPeriod', label: 'Examiner’s period', meaning: '“, a period the examiner set, which may be extended only for good cause” when the examiner set it; blank otherwise' },
  { key: 'noiDate', label: 'Allowance date', meaning: 'the date of the Notice of Allowance' },
  { key: 'feesDue', label: '1st publication fee due', meaning: 'the last day to pay the 1st publication fee — only for an application filed on or before 13 Feb 2023; blank otherwise' },
  { key: 'issuanceNoticeDate', label: 'Issuance notice date', meaning: 'the date of the Notice of Issuance' },
  { key: 'issuanceFeesDue', label: 'Issuance fees due', meaning: 'the last day to pay the issuance and 2nd publication fees, two months from the Notice of Issuance' },
  { key: 'issuanceFeesPaid', label: 'Issuance fees paid', meaning: 'the day the issuance and 2nd publication fees were paid; blank when not yet paid' },
  { key: 'publishedDate', label: 'Published on', meaning: 'the day the mark was published' },
  { key: 'oppositionEnds', label: 'Opposition ends', meaning: 'the last day of the 30-day opposition period' },
  { key: 'deemedRegistered', label: 'Deemed registered', meaning: 'the day the mark is deemed registered if no one opposes' },
  { key: 'regDate', label: 'Registration date', meaning: 'the date of registration' },
  { key: 'registrationNo', label: 'Registration no.', meaning: 'the registration number; blank before registration' },
  { key: 'expiryDate', label: 'Expiry', meaning: 'the day the registration expires, 10 years from registration' },
  { key: 'renewedExpiry', label: 'Renewed expiry', meaning: 'the day the renewed registration expires, 20 years from registration' },
  { key: 'dau3Due', label: '3rd-year DAU due', meaning: 'three years from filing' },
  { key: 'dau3ExtendedDue', label: '3rd-year DAU, extended', meaning: 'the 3rd-year DAU date with the 6-month extension; blank once the extension is used' },
  { key: 'dau5Opens', label: '5th-year DAU opens', meaning: 'the fifth anniversary of registration' },
  { key: 'dau5Due', label: '5th-year DAU due', meaning: 'one year after the fifth anniversary of registration' },
  { key: 'renewalOpens', label: 'Renewal opens', meaning: 'six months before expiry' },
  { key: 'renewalDue', label: 'Renewal due', meaning: 'the expiry date' },
  { key: 'renewalGraceEnds', label: 'Renewal grace ends', meaning: 'six months after expiry, with the surcharge' },
  { key: 'renewalDauOpens', label: 'Post-renewal DAU opens', meaning: 'six months before the registration expires' },
  { key: 'renewalDauDue', label: 'Post-renewal DAU due', meaning: 'one year from renewal' },
  { key: 'renewalDau5Opens', label: 'Post-renewal 5th-year DAU opens', meaning: 'the fifth anniversary of renewal' },
  { key: 'renewalDau5Due', label: 'Post-renewal 5th-year DAU due', meaning: 'one year after the fifth anniversary of renewal' },
  { key: 'proofDue', label: 'Proof of use due', meaning: 'the day the client is asked to send proof of use by (inside the proof-of-use block)' },
  { key: 'office', label: 'Designated office', meaning: 'for a Madrid designation, the office that examines it: IPOPHL for the Philippines, else that country’s trademark office' },
  { key: 'country', label: 'Designated country', meaning: 'for a Madrid designation, where it is: “the Philippines”, “Japan”, “the United States”' },
  { key: 'irNo', label: 'IR no.', meaning: 'for a Madrid designation, the international registration number' },
  { key: 'irDate', label: 'IR date', meaning: 'for a Madrid designation, the date of the international registration' },
];

/** Fields that stand alone as a paragraph and bring in a list or a shared block. */
export const BLOCK_FIELDS: LetterPlaceholder[] = [
  { key: 'goodsByClass', label: 'Goods & services list', meaning: 'the goods or services, one paragraph per class' },
  { key: 'proofOfUse', label: 'Proof of use', meaning: 'the shared proof-of-use request and list' },
  { key: 'dau3Reminder', label: '3rd-year DAU reminder', meaning: 'the shared 3rd-year DAU paragraph, left out once that DAU is filed' },
  { key: 'dau5Reminder', label: '5th-year DAU reminder', meaning: 'the shared 5th-year DAU paragraph (its “before registration” version for a pending mark)' },
  { key: 'renewalReminder', label: 'Renewal reminder', meaning: 'the shared expiry-and-renewal paragraph' },
  { key: 'awaitingRegistration', label: 'Awaiting registration', meaning: 'the shared paragraph on the coming certificate, left out once registered' },
  { key: 'allowanceFees', label: 'Fees on allowance', meaning: 'what is due on the Notice of Allowance: the 1st publication fee for a filing up to 13 Feb 2023, else nothing, with the option to pay the issuance fees early' },
];

const ALL_FIELD_KEYS = new Set([...WORDING_FIELDS, ...BLOCK_FIELDS].map((f) => f.key));
const BLOCK_KEYS = new Set(BLOCK_FIELDS.map((f) => f.key));

export interface WordingBlock {
  key: string;
  /** The report it belongs to, or "Shared". */
  group: string;
  label: string;
  when: string;
  body: string;
}

const IPOPHL = 'the Intellectual Property Office of the Philippines (IPOPHL)';
const ANNEX = '[[ {{annexes}}]]';
/**
 * The covering email, in the words the firm's own report emails use: what
 * happened, what is attached, that we are watching the next deadline (the
 * caption names it), and a request to confirm receipt.
 */
const MESSAGE = (what: string, report = 'Status Report') =>
  `${what}\n\n` +
  `Please find attached our ${report}[[ and {{annexCopies}}]], for your records and reference.\n\n` +
  'We will continue to monitor the upcoming deadline noted above and will keep you duly informed of any developments.\n\n' +
  'Kindly confirm receipt of this email and its attachments at your convenience.';

export const SHARED_BLOCKS: WordingBlock[] = [
  {
    key: 'shared.closing', group: 'Shared', label: 'Closing paragraph', when: 'Every report, before “Very truly yours,”',
    body: 'Should you have any questions, please do not hesitate to let us know.',
  },
  {
    key: 'shared.dau3_reminder', group: 'Shared', label: '3rd-year DAU reminder', when: 'Where a report has {{dau3Reminder}}, until the 3rd-year DAU is filed',
    body:
      'Under Section 124.2 of the Intellectual Property Code, a Declaration of Actual Use (DAU) of the mark, with proof of use, must be filed within ' +
      'three (3) years from the filing date of the application, that is, on or before **{{dau3Due}}**. [[This period may be extended once, by six (6) ' +
      'months to {{dau3ExtendedDue}}, on a request filed and paid for before it lapses. ]]If no DAU is filed, the application will be refused or the mark ' +
      'removed from the Register.\n\n{{proofOfUse}}',
  },
  {
    key: 'shared.proof_of_use', group: 'Shared', label: 'Proof of use', when: 'Where a report or block has {{proofOfUse}}',
    body:
      'To file the DAU, we will need proof that the mark is used in the Philippines. Kindly send us any of the following by {{proofDue}}:\n\n' +
      '- labels or packaging showing the mark as actually used on the goods;\n' +
      '- photographs of the goods bearing the mark, or of the store or establishment displaying it;\n' +
      '- pages of a website or social media account showing the goods or services offered under the mark;\n' +
      '- brochures, menus or other advertising materials showing the mark; and\n' +
      '- receipts or sales invoices showing the mark.',
  },
  {
    key: 'shared.dau5_reminder', group: 'Shared', label: '5th-year DAU reminder', when: 'Where a report has {{dau5Reminder}}, on a registered mark',
    body:
      'Under Section 145 of the Intellectual Property Code, a further DAU must be filed within one (1) year from the fifth anniversary of the registration ' +
      'of the mark, that is, between **{{dau5Opens}}** and **{{dau5Due}}**. This period cannot be extended, and a mark for which no DAU is filed is removed ' +
      'from the Register. We will remind you before it opens.',
  },
  {
    key: 'shared.dau5_pending', group: 'Shared', label: '5th-year DAU reminder (before registration)', when: 'Where a report has {{dau5Reminder}}, on a mark not yet registered',
    body:
      'Under Section 145 of the Intellectual Property Code, once the mark is registered, a further DAU must be filed within one (1) year from the fifth ' +
      'anniversary of its registration. We will give you that date when IPOPHL issues the Certificate of Registration.',
  },
  {
    key: 'shared.renewal_reminder', group: 'Shared', label: 'Renewal reminder', when: 'Where a report has {{renewalReminder}}',
    body:
      'The registration remains in force until **{{expiryDate}}**. It may be renewed for a further ten (10) years by a request filed between ' +
      '**{{renewalOpens}}** and **{{renewalDue}}**, or within six (6) months after it expires, until {{renewalGraceEnds}}, on payment of a surcharge. ' +
      'We will remind you before the renewal period opens.',
  },
  {
    key: 'shared.allowance_first_fee', group: 'Shared', label: 'Fees on allowance (filed up to 13 Feb 2023)', when: 'Where a report has {{allowanceFees}}, on an application filed on or before 13 Feb 2023',
    body:
      'The 1st publication fee must be paid within two (2) months from the date of the notice, that is, on or before **{{feesDue}}**. This period ' +
      'cannot be extended, and if the fee is not paid, the application will be deemed abandoned. Kindly confirm that we may pay the fee on your behalf; ' +
      'we will bill it to you with our fee for the payment.',
  },
  {
    key: 'shared.allowance_no_fee', group: 'Shared', label: 'Fees on allowance (filed from 14 Feb 2023)', when: 'Where a report has {{allowanceFees}}, on an application filed on or after 14 Feb 2023',
    body:
      'No fee is due on the notice: the 1st publication fee was paid with the application. The issuance and 2nd publication fees, which would ' +
      'otherwise be paid once the opposition period ends, may be paid now to have the Certificate of Registration issued sooner. Kindly let us know ' +
      'if you wish us to pay them in advance; the fees are not refunded if the application does not proceed to registration.',
  },
  {
    key: 'shared.awaiting_registration', group: 'Shared', label: 'Awaiting registration', when: 'Where a report has {{awaitingRegistration}}, until the mark is registered',
    body:
      'Once the mark is registered, IPOPHL will issue the Certificate of Registration, which we will send to you. The registration is valid for ten (10) ' +
      'years from its date and may be renewed.',
  },
];

/** Each report's letter body and email message, by report key. */
export const REPORT_BLOCKS: Record<string, { label: string; body: string; message: string; extra?: WordingBlock[] }> = {
  filing: {
    label: 'Filing report',
    body:
      `We are pleased to report that on {{eventDate}}, we filed with ${IPOPHL} the application for the registration of the mark **{{mark}}** in the name ` +
      `of {{applicant}}[[, which IPOPHL assigned Application No. {{applicationNo}}]].${ANNEX}\n\n` +
      'The application covers the following goods or services:\n\n{{goodsByClass}}\n\n' +
      'IPOPHL will now examine the application. If the examiner raises any objection in an Office Action, it must generally be answered within two (2) ' +
      'months from its mailing date, and we will report it to you as soon as we receive it.\n\n{{dau3Reminder}}',
    message: MESSAGE(`We write to inform you that the above-referenced trademark application was filed with ${IPOPHL} on {{filingDate}}.`, 'Filing Report'),
  },
  oa_received: {
    label: 'Office Action report',
    body:
      `We write to inform you that ${IPOPHL} has issued the {{oaName}} dated {{oaDate}} on the application for the registration of the mark ` +
      `**{{mark}}**[[, which we received on {{receivedDate}}]].${ANNEX}\n\n` +
      'The Office Action must be answered on or before **{{responseDue}}**[[, that is, within two (2) months from its mailing date. This period may be ' +
      'extended by a further two (2) months, to {{responseExtendedDue}}, on a request filed and paid for before it lapses]][[{{examinerPeriod}}]]. If it is ' +
      'not answered, the application will be deemed abandoned.\n\n' +
      'We are reviewing the examiner’s objections and will send you our recommendations. So that we have time to prepare and file the response, kindly ' +
      'let us have your instructions, and any documents or information the Office Action calls for, at the earliest opportunity.',
    message: MESSAGE(`We advise that ${IPOPHL} has issued the {{oaName}} dated {{oaDate}} on the above-referenced application[[, which we received on {{receivedDate}}]]. The deadline to file the {{responseWhat}} it is on {{responseDue}}[[; it may be extended once by two (2) months, until {{responseExtendedDue}}]]. We await your instructions.`),
    extra: [{
      key: 'oa_received.body_final', group: 'Office Action report', label: 'Letter body — final rejection', when: 'Instead of the letter body when the round is a final rejection',
      body:
        `We write to inform you that ${IPOPHL} has issued a final rejection dated {{oaDate}} on the application for the registration of the mark ` +
        `**{{mark}}**[[, which we received on {{receivedDate}}]].${ANNEX}\n\n` +
        'The examiner has made the refusal final. The refusal may be appealed to the Director of the Bureau of Trademarks, or the examiner’s ' +
        'requirements complied with, within two (2) months from the mailing date, that is, on or before **{{responseDue}}**[[, extendible by a further ' +
        'two (2) months to {{responseExtendedDue}} on a request filed before the period lapses]]. If neither is done, the application will be deemed ' +
        'abandoned.\n\n' +
        'We are reviewing the final rejection and will send you our recommendations. Kindly let us have your instructions at the earliest opportunity.',
    }, {
      key: 'oa_received.body_madrid', group: 'Office Action report', label: 'Letter body — Madrid designation', when: 'Instead of the letter body when the mark is a designation under the Madrid Protocol',
      body:
        'We write to inform you that {{office}} has issued a {{oaName}} dated {{oaDate}} on International Registration No. {{irNo}} of the mark ' +
        `**{{mark}}**, as it designates {{country}}[[, which we received on {{receivedDate}}]].${ANNEX}\n\n` +
        'The refusal must be answered on or before **{{responseDue}}**, the date stated in the notice. If it is not answered, the mark will not be ' +
        'protected in {{country}}.\n\n' +
        'We are reviewing the grounds of the refusal and will send you our recommendations. So that we have time to prepare and file the response, ' +
        'kindly let us have your instructions, and any documents or information the refusal calls for, at the earliest opportunity.',
    }, {
      key: 'oa_received.message_madrid', group: 'Office Action report', label: 'Email message — Madrid designation', when: 'Instead of the email message when the mark is a designation under the Madrid Protocol',
      body: MESSAGE('We advise that {{office}} has issued a {{oaName}} dated {{oaDate}} on the above-referenced international registration, as it designates {{country}}[[, which we received on {{receivedDate}}]]. The deadline to respond is on {{responseDue}}. We await your instructions.'),
    }],
  },
  oa_response: {
    label: 'Office Action response report',
    body:
      `We are pleased to report that on {{eventDate}}, we filed with ${IPOPHL} our {{responseWhat}} the {{oaName}} dated {{oaDate}} on the application ` +
      `for the registration of the mark **{{mark}}**.${ANNEX}\n\n` +
      'IPOPHL will now consider the response. If the examiner is satisfied, IPOPHL will allow the application and issue a Notice of Allowance, after ' +
      'which the mark is published for opposition. If the examiner maintains any objection, we will report it to you with our recommendations.\n\n' +
      '{{dau3Reminder}}',
    message: MESSAGE(`We write to inform you that we filed with ${IPOPHL} on {{eventDate}} our {{responseWhat}} the {{oaName}} dated {{oaDate}}.`),
    extra: [{
      key: 'oa_response.body_madrid', group: 'Office Action response report', label: 'Letter body — Madrid designation', when: 'Instead of the letter body when the mark is a designation under the Madrid Protocol',
      body:
        'We are pleased to report that on {{eventDate}}, we filed with {{office}} our {{responseWhat}} the {{oaName}} dated {{oaDate}} on International ' +
        `Registration No. {{irNo}} of the mark **{{mark}}**, as it designates {{country}}.${ANNEX}\n\n` +
        'The office will now consider the response. If the refusal is withdrawn, it will grant protection to the mark in {{country}}; if the refusal ' +
        'is maintained, we will report it to you with our recommendations.',
    }, {
      key: 'oa_response.message_madrid', group: 'Office Action response report', label: 'Email message — Madrid designation', when: 'Instead of the email message when the mark is a designation under the Madrid Protocol',
      body: MESSAGE('We write to inform you that we filed with {{office}} on {{eventDate}} our {{responseWhat}} the {{oaName}} dated {{oaDate}} on the above-referenced international registration.'),
    }],
  },
  oa_motex: {
    label: 'Office Action extension report',
    body:
      `We are pleased to report that we filed with ${IPOPHL} a request for an extension of time to respond to the {{oaName}} dated {{oaDate}} on the ` +
      `application for the registration of the mark **{{mark}}**, and paid the fee for it.${ANNEX}\n\n` +
      'The response is now due on or before **{{responseExtendedDue}}**. This period cannot be extended further, and if the Office Action is not answered ' +
      'by then, the application will be deemed abandoned. Kindly let us have your instructions, and any documents or information the Office Action ' +
      'calls for, at the earliest opportunity.',
    message: MESSAGE(`We write to inform you that we requested from ${IPOPHL} an extension of time to respond to the {{oaName}} dated {{oaDate}}[[. The response is now due on {{responseExtendedDue}}]].`),
  },
  oa_motex_granted: {
    label: 'Office Action extension granted report',
    body:
      `We are pleased to report that ${IPOPHL} has granted our request for an extension of time to respond to the {{oaName}} dated {{oaDate}} on ` +
      `the application for the registration of the mark **{{mark}}**, by an order dated {{eventDate}}.${ANNEX}\n\n` +
      'The response is due on or before **{{responseExtendedDue}}**. This period cannot be extended further, and if the Office Action is not answered ' +
      'by then, the application will be deemed abandoned. Kindly let us have your instructions, and any documents or information the Office Action ' +
      'calls for, at the earliest opportunity.',
    message: MESSAGE(`We are pleased to inform you that ${IPOPHL} has granted the extension of time to respond to the {{oaName}} dated {{oaDate}}[[. The response is now due on {{responseExtendedDue}}]].`),
  },
  oa_motex_denied: {
    label: 'Office Action extension denied report',
    body:
      `We regret to inform you that ${IPOPHL} has denied our request for an extension of time to respond to the {{oaName}} dated {{oaDate}} on ` +
      `the application for the registration of the mark **{{mark}}**, by an order dated {{eventDate}}.${ANNEX}\n\n` +
      'The original period to respond, ending on **{{responseDue}}**, therefore applies. We will advise you separately on the steps available to ' +
      'protect the application. Kindly let us have your instructions at the earliest opportunity.',
    message: MESSAGE(`We regret to inform you that ${IPOPHL} has denied the extension of time to respond to the {{oaName}} dated {{oaDate}}. The original period to respond, ending on {{responseDue}}, applies.`),
  },
  noi_received: {
    label: 'Notice of Allowance report',
    body:
      `We are pleased to inform you that ${IPOPHL} has allowed the application for the registration of the mark **{{mark}}** and issued a Notice of ` +
      `Allowance dated {{noiDate}}[[, which we received on {{receivedDate}}]], approving its publication for opposition.${ANNEX}\n\n` +
      '{{allowanceFees}}\n\n' +
      'IPOPHL will publish the mark in its Electronic Gazette. Any person who believes they would be damaged by the registration may oppose it within ' +
      'thirty (30) days from publication. If no opposition is filed, IPOPHL will issue a Notice of Issuance for the issuance and 2nd publication fees, ' +
      'and then the Certificate of Registration.',
    message: MESSAGE(`We are pleased to inform you that ${IPOPHL} has issued a Notice of Allowance dated {{noiDate}} for the above-referenced mark[[, which we received on {{receivedDate}}]], approving its publication for opposition.[[ The 1st publication fee must be paid on or before {{feesDue}}.]]`),
  },
  noi_paid: {
    label: '1st publication fee payment report',
    body:
      `We are pleased to report that on {{eventDate}}, we paid to ${IPOPHL} the 1st publication fee for the mark **{{mark}}**, following the Notice of ` +
      `Allowance[[ dated {{noiDate}}]].${ANNEX}\n\n` +
      'IPOPHL will now publish the mark in its Electronic Gazette. Any person who believes they would be damaged by the registration may oppose it ' +
      'within thirty (30) days from publication. We will report the publication to you.\n\n{{dau3Reminder}}',
    message: MESSAGE('We write to inform you that we paid the 1st publication fee for the above-referenced mark on {{eventDate}}. The mark will next be published for opposition.'),
  },
  published: {
    label: 'Publication report',
    body:
      `We are pleased to report that on {{publishedDate}}, ${IPOPHL} published the mark **{{mark}}** in its Electronic Gazette.${ANNEX}\n\n` +
      'Any person who believes they would be damaged by the registration of the mark may oppose it within thirty (30) days from publication, that is, ' +
      'until **{{oppositionEnds}}**. If no opposition is filed, IPOPHL will issue a Notice of Issuance for the issuance and 2nd publication fees' +
      '[[, which we paid in advance on {{issuanceFeesPaid}}]], and then the Certificate of Registration. We will report any opposition to you.\n\n' +
      '{{dau3Reminder}}',
    message: MESSAGE('We write to inform you that the above-referenced mark was published for opposition on {{publishedDate}}.'),
  },
  issuance_received: {
    label: 'Notice of Issuance report',
    body:
      `We are pleased to inform you that no opposition was filed against the mark **{{mark}}**, and ${IPOPHL} has issued a Notice of Issuance dated ` +
      `{{issuanceNoticeDate}}[[, which we received on {{receivedDate}}]].${ANNEX}\n\n` +
      'The issuance and 2nd publication fees must be paid within two (2) months from the date of the notice, that is, on or before ' +
      '**{{issuanceFeesDue}}**. If the fees are not paid, the application will be deemed abandoned. Kindly confirm that we may pay the fees on your ' +
      'behalf; we will bill them to you with our fee for the payment.\n\n{{awaitingRegistration}}',
    message: MESSAGE(`We are pleased to inform you that no opposition was filed against the above-referenced mark, and ${IPOPHL} has issued a Notice of Issuance dated {{issuanceNoticeDate}}[[, which we received on {{receivedDate}}]]. The issuance and 2nd publication fees must be paid on or before {{issuanceFeesDue}}.`),
  },
  issuance_paid: {
    label: 'Issuance fee payment report',
    body:
      `We are pleased to report that on {{eventDate}}, we paid to ${IPOPHL} the issuance and 2nd publication fees for the mark **{{mark}}**.${ANNEX}\n\n` +
      'Once the opposition period has passed without opposition, IPOPHL will issue the Certificate of Registration and publish the registration.\n\n' +
      '{{awaitingRegistration}}\n\n{{dau3Reminder}}',
    message: MESSAGE('We write to inform you that we paid the issuance and 2nd publication fees for the above-referenced mark on {{eventDate}}. The Certificate of Registration will issue next.'),
  },
  cor: {
    label: 'Registration report',
    body:
      `We are pleased to report that ${IPOPHL} has registered the mark **{{mark}}** in the name of {{applicant}}[[ under Registration No. ` +
      `{{registrationNo}}]], effective {{regDate}}.${ANNEX}\n\n` +
      'The registration is valid for ten (10) years, until **{{expiryDate}}**, and may be renewed for further periods of ten (10) years. To keep it in ' +
      'force, the owner must file Declarations of Actual Use (DAU) of the mark, with proof of use, as follows.\n\n{{dau3Reminder}}\n\n{{dau5Reminder}}',
    message: MESSAGE(`We are pleased to inform you that ${IPOPHL} has issued a Certificate of Registration for the mark {{mark}}[[, Registration No. {{registrationNo}}]], registered on {{regDate}}.`),
  },
  protection: {
    label: 'Protection report',
    body:
      'We are pleased to report that {{office}} has granted protection to the mark **{{mark}}** in {{country}} under International Registration ' +
      `No. {{irNo}}[[, by a statement of grant of protection dated {{regDate}}]].${ANNEX}\n\n` +
      'The mark is now protected in {{country}} as if it had been registered there directly, for as long as the international registration remains ' +
      'in force.',
    message: MESSAGE('We are pleased to inform you that {{office}} has granted protection to the above-referenced mark in {{country}}[[, by a statement dated {{regDate}}]].', 'Protection Report'),
  },
  dau_3: {
    label: '3rd-year DAU report',
    body:
      `We are pleased to report that on {{eventDate}}, we filed with ${IPOPHL} the Declaration of Actual Use (DAU) for the mark **{{mark}}**, which must ` +
      `be filed within three (3) years from the filing date of the application, {{filingDate}}.${ANNEX}\n\n{{awaitingRegistration}}\n\n{{dau5Reminder}}`,
    message: MESSAGE(`We write to inform you that we filed the 3rd Year Declaration of Actual Use for the above-referenced mark with ${IPOPHL} on {{eventDate}}.`),
  },
  dau_3_motex: {
    label: '3rd-year DAU extension report',
    body:
      `We are pleased to report that we filed with ${IPOPHL} a request for a six (6)-month extension of time to file the Declaration of Actual Use (DAU) ` +
      `for the mark **{{mark}}**, which was due on {{dau3Due}}, and paid the fee for it.${ANNEX}\n\n` +
      'The DAU is now due on or before **{{proofDue}}**. This period cannot be extended further, and if no DAU is filed by then, the application will ' +
      'be refused or the mark removed from the Register.\n\n{{proofOfUse}}',
    message: MESSAGE(`We write to inform you that we requested from ${IPOPHL} an extension of time to file the 3rd Year Declaration of Actual Use for the above-referenced mark.`),
  },
  dau_3_motex_granted: {
    label: '3rd-year DAU extension granted report',
    body:
      `We are pleased to report that ${IPOPHL} has granted our request for a six (6)-month extension of time to file the Declaration of Actual Use ` +
      `(DAU) for the mark **{{mark}}**, by an order dated {{eventDate}}.${ANNEX}\n\n` +
      'The DAU is now due on or before **{{proofDue}}**. This period cannot be extended further, and if no DAU is filed by then, the application will ' +
      'be refused or the mark removed from the Register.\n\n{{proofOfUse}}',
    message: MESSAGE(`We are pleased to inform you that ${IPOPHL} has granted the extension of time to file the 3rd Year Declaration of Actual Use for the above-referenced mark[[. The DAU is now due on {{proofDue}}]].`),
  },
  dau_3_motex_denied: {
    label: '3rd-year DAU extension denied report',
    body:
      `We regret to inform you that ${IPOPHL} has denied our request for an extension of time to file the Declaration of Actual Use (DAU) for the ` +
      `mark **{{mark}}**, by an order dated {{eventDate}}.${ANNEX}\n\n` +
      'The original period, ending on **{{dau3Due}}**, therefore applies. If no DAU is filed within it, the application will be refused or the mark ' +
      'removed from the Register. We will advise you separately on the steps available.\n\n{{proofOfUse}}',
    message: MESSAGE(`We regret to inform you that ${IPOPHL} has denied the extension of time to file the 3rd Year Declaration of Actual Use for the above-referenced mark. The original period, ending on {{dau3Due}}, applies.`),
  },
  dau_5: {
    label: '5th-year DAU report',
    body:
      `We are pleased to report that on {{eventDate}}, we filed with ${IPOPHL} the Declaration of Actual Use (DAU) for the mark **{{mark}}** due within ` +
      `one (1) year from the fifth anniversary of its registration on {{regDate}}.${ANNEX}\n\n{{renewalReminder}}`,
    message: MESSAGE(`We write to inform you that we filed the 5th Year Declaration of Actual Use for the above-referenced mark with ${IPOPHL} on {{eventDate}}.`),
  },
  renewal: {
    label: 'Renewal report',
    body:
      `We are pleased to report that on {{eventDate}}, we filed with ${IPOPHL} the request for the renewal of the registration of the mark ` +
      `**{{mark}}**.${ANNEX}\n\n` +
      'Upon renewal, the registration continues for a further ten (10) years from its expiry on {{expiryDate}}, until **{{renewedExpiry}}**.\n\n' +
      'A Declaration of Actual Use (DAU) of the mark, with proof of use, must be filed within one (1) year from the date of renewal, that is, between ' +
      '**{{renewalDauOpens}}** and **{{renewalDauDue}}**. This period cannot be extended, and a mark for which no DAU is filed is removed from the ' +
      'Register.\n\n{{proofOfUse}}',
    message: MESSAGE(`We write to inform you that we filed the request for the renewal of the registration of the above-referenced mark with ${IPOPHL} on {{eventDate}}.`),
  },
  renewal_dau: {
    label: 'Post-renewal DAU report',
    body:
      `We are pleased to report that on {{eventDate}}, we filed with ${IPOPHL} the Declaration of Actual Use (DAU) for the mark **{{mark}}** due within ` +
      `one (1) year from the renewal of its registration.${ANNEX}\n\n` +
      'A further DAU must be filed within one (1) year from the fifth anniversary of the renewal, that is, between **{{renewalDau5Opens}}** and ' +
      '**{{renewalDau5Due}}**. This period cannot be extended. We will remind you before it opens.',
    message: MESSAGE(`We write to inform you that we filed the Declaration of Actual Use after renewal for the above-referenced mark with ${IPOPHL} on {{eventDate}}.`),
  },
  renewal_dau_5: {
    label: 'Post-renewal 5th-year DAU report',
    body:
      `We are pleased to report that on {{eventDate}}, we filed with ${IPOPHL} the Declaration of Actual Use (DAU) for the mark **{{mark}}** due within ` +
      `one (1) year from the fifth anniversary of the renewal of its registration.${ANNEX}\n\n` +
      'The registration, as renewed, remains in force until **{{renewedExpiry}}**, and may be renewed again within the six (6) months before it ' +
      'expires. We will remind you before that period opens.',
    message: MESSAGE(`We write to inform you that we filed the 5th Year Declaration of Actual Use after renewal for the above-referenced mark with ${IPOPHL} on {{eventDate}}.`),
  },
};

/** Every editable block, shared ones first, with its default. */
export const WORDING_BLOCKS: WordingBlock[] = [
  ...SHARED_BLOCKS,
  ...Object.entries(REPORT_BLOCKS).flatMap(([report, r]) => [
    { key: `${report}.body`, group: r.label, label: 'Letter body', when: 'Between the salutation and the closing paragraph', body: r.body },
    ...(r.extra ?? []),
    { key: `${report}.message`, group: r.label, label: 'Email message', when: 'The covering email, after the caption and salutation; editable again when sending', body: r.message },
  ]),
];

const DEFAULTS = new Map(WORDING_BLOCKS.map((b) => [b.key, b.body]));

export function isWordingKey(key: string): boolean {
  return DEFAULTS.has(key);
}

export type Wording = Record<string, string>;

/** The defaults with the saved wording over them. */
export function wordingFrom(rows: { key: string; body: string }[] = []): Wording {
  const out: Wording = Object.fromEntries(DEFAULTS);
  for (const r of rows) if (DEFAULTS.has(r.key) && r.body.trim()) out[r.key] = r.body;
  return out;
}

/** Why a block can't be saved as typed, or null. */
export function wordingProblem(body: string): string | null {
  const shared = sharedWordingProblem(body, ALL_FIELD_KEYS);
  if (shared) return shared;
  const misplaced = body.split(/\n\s*\n/).flatMap((p) =>
    [...p.matchAll(FIELD_RE)].map((m) => m[1]).filter((f) => BLOCK_KEYS.has(f) && p.trim() !== `{{${f}}}`));
  if (misplaced.length) return `{{${misplaced[0]}}} must be a paragraph on its own.`;
  return null;
}

export { fillWording };

/**
 * Wording as letter paragraphs, with this report's block fields
 * (lib/client-reports/wording.ts).
 */
export function wordingToParagraphs(
  body: string,
  fields: Record<string, string>,
  blocks: (key: string) => LetterParagraph[],
): LetterParagraph[] {
  return sharedWordingToParagraphs(body, fields, blocks, BLOCK_KEYS);
}
