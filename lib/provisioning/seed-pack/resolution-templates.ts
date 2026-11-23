/**
 * The corporate resolution catalogue a new firm starts with — 35 board
 * resolutions covering banking, real estate, governance, capital, HR, tax,
 * litigation, government filings, and credit.
 *
 * Source: the `TEMPLATES` array that lived inside scripts/seed-resolution-templates.ts.
 * It was already firm-neutral — generic Philippine corporate boilerplate written
 * against "the Corporation" with `{{token}}` variables, naming no firm, client,
 * or person — so it moved here verbatim and the script now seeds from this
 * module for one named firm. (It could not have run as it stood: it wrote with a
 * raw client and no `firm_id`, which raises 23502 since the transitional column
 * defaults were dropped.)
 *
 * `key` is firm-local. `resolution_templates.id` is a GLOBAL text primary key —
 * there is no `(firm_id, id)` unique — so provisioning namespaces these keys per
 * firm before insert. Seeding two firms with the same bare ids would have the
 * second firm's upsert silently rewrite the first firm's catalogue.
 */

import type { ResolutionTemplateSeed, ResolutionVariable } from './types';

const T = (
  key: string,
  name: string,
  kind: ResolutionTemplateSeed['kind'],
  category: ResolutionTemplateSeed['category'],
  description: string,
  body_template: string,
  variable_schema: ResolutionVariable[],
  sort_order = 0,
): ResolutionTemplateSeed => ({
  key,
  name,
  kind,
  category,
  description,
  body_template,
  variable_schema,
  sort_order,
  is_active: true,
});

export const SEED_RESOLUTION_TEMPLATES: ResolutionTemplateSeed[] = [
  // Banking
  T('open-bank-account', 'Open Bank Account', 'Board Resolution', 'Banking',
    'Authorize opening of a corporate deposit account with a named bank and signatory.',
    `RESOLVED, that the Corporation open and maintain a {{account_type}} account with {{bank_name}}, {{bank_branch}} Branch, and that {{signatory_name}}, in his/her capacity as {{signatory_position}}, be and is hereby authorized to sign, endorse, and deliver checks, drafts, and other instruments for and on behalf of the Corporation, with full authority to withdraw funds, transact business, and execute all documents necessary or incidental to the operation of said account.`,
    [
      { key: 'bank_name', label: 'Bank Name', type: 'text', required: true },
      { key: 'bank_branch', label: 'Branch', type: 'text', required: true },
      { key: 'account_type', label: 'Account Type', type: 'select', required: true, options: ['checking', 'savings', 'time deposit', 'foreign currency'] },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
      { key: 'signatory_position', label: 'Signatory Position', type: 'text', required: true },
    ], 10),

  T('designate-bank-signatories', 'Designate Bank Signatories', 'Board Resolution', 'Banking',
    'Designate or update authorized signatories for an existing corporate account.',
    `RESOLVED, that the following officers of the Corporation be and are hereby designated as authorized signatories for the Corporation's account with {{bank_name}}, with signing authority as follows: {{signatory_block}}. Said signatories shall sign in accordance with the signing combination specified above for all checks, withdrawals, and instructions issued for and on behalf of the Corporation.`,
    [
      { key: 'bank_name', label: 'Bank Name', type: 'text', required: true },
      { key: 'signatory_block', label: 'Signatory Block (name, position, signing combination)', type: 'textarea', required: true },
    ], 20),

  T('time-deposit-placement', 'Time Deposit Placement', 'Board Resolution', 'Banking',
    'Authorize placement of corporate funds in a time-deposit instrument.',
    `RESOLVED, that the Corporation place the amount of {{amount}} in a time deposit with {{bank_name}} for a term of {{term}}, and that {{signatory_name}} be and is hereby authorized to execute all documents and instructions necessary to consummate said placement.`,
    [
      { key: 'amount', label: 'Amount (PHP)', type: 'text', required: true },
      { key: 'bank_name', label: 'Bank Name', type: 'text', required: true },
      { key: 'term', label: 'Term (e.g. 30 days, 1 year)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 30),

  T('issue-managers-check', 'Issue Manager\'s Check', 'Board Resolution', 'Banking',
    'Authorize a one-off manager\'s/cashier\'s check.',
    `RESOLVED, that the Corporation issue a manager's check in the amount of {{amount}} payable to {{payee}} for {{purpose}}, and that {{signatory_name}} be and is hereby authorized to sign and procure said instrument from {{bank_name}}.`,
    [
      { key: 'amount', label: 'Amount (PHP)', type: 'text', required: true },
      { key: 'payee', label: 'Payee', type: 'text', required: true },
      { key: 'purpose', label: 'Purpose', type: 'text', required: true },
      { key: 'bank_name', label: 'Issuing Bank', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 40),

  T('close-bank-account', 'Close Bank Account', 'Board Resolution', 'Banking',
    'Authorize closure of a corporate bank account.',
    `RESOLVED, that the Corporation close its {{account_type}} account number {{account_number}} maintained with {{bank_name}}, {{bank_branch}} Branch, and that {{signatory_name}} be and is hereby authorized to execute all documents and receive any remaining proceeds to effect said closure.`,
    [
      { key: 'bank_name', label: 'Bank Name', type: 'text', required: true },
      { key: 'bank_branch', label: 'Branch', type: 'text', required: true },
      { key: 'account_type', label: 'Account Type', type: 'text', required: true },
      { key: 'account_number', label: 'Account Number', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 50),

  // Loans & Credit
  T('apply-for-loan', 'Apply for Loan / Credit Facility', 'Board Resolution', 'Loans & Credit',
    'Authorize loan application and execution of credit documents.',
    `RESOLVED, that the Corporation apply for and obtain from {{lender_name}} a {{facility_type}} in the amount not exceeding {{amount}} for {{purpose}}, on such terms and conditions as may be acceptable to the authorized representative, and that {{signatory_name}}, in his/her capacity as {{signatory_position}}, be and is hereby authorized to negotiate, sign, and deliver all documents necessary or incidental to said facility, including but not limited to the loan agreement, promissory notes, security documents, and disclosure statements.`,
    [
      { key: 'lender_name', label: 'Lender Name', type: 'text', required: true },
      { key: 'facility_type', label: 'Facility Type (e.g. term loan, credit line)', type: 'text', required: true },
      { key: 'amount', label: 'Maximum Amount (PHP)', type: 'text', required: true },
      { key: 'purpose', label: 'Purpose', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
      { key: 'signatory_position', label: 'Signatory Position', type: 'text', required: true },
    ], 10),

  T('chattel-mortgage', 'Chattel Mortgage / Pledge', 'Board Resolution', 'Loans & Credit',
    'Authorize execution of a chattel mortgage or pledge over corporate personalty.',
    `RESOLVED, that the Corporation execute a chattel mortgage / pledge in favor of {{mortgagee_name}} over the following corporate personalty: {{collateral_description}}, to secure the obligation in the principal amount of {{secured_amount}}, and that {{signatory_name}} be and is hereby authorized to sign and deliver the mortgage / pledge instrument and all supporting documents.`,
    [
      { key: 'mortgagee_name', label: 'Mortgagee / Pledgee', type: 'text', required: true },
      { key: 'collateral_description', label: 'Collateral Description', type: 'textarea', required: true },
      { key: 'secured_amount', label: 'Secured Amount (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 20),

  T('surety-guarantee', 'Issue Surety / Guarantee', 'Board Resolution', 'Loans & Credit',
    'Authorize the Corporation to act as surety or guarantor for a related party.',
    `RESOLVED, that the Corporation act as {{role_type}} for the obligation of {{principal_obligor}} in favor of {{creditor_name}} in the amount of {{guaranteed_amount}}, and that {{signatory_name}} be and is hereby authorized to execute and deliver the {{role_type}} agreement and all related documents.`,
    [
      { key: 'role_type', label: 'Role', type: 'select', required: true, options: ['surety', 'guarantor'] },
      { key: 'principal_obligor', label: 'Principal Obligor', type: 'text', required: true },
      { key: 'creditor_name', label: 'Creditor', type: 'text', required: true },
      { key: 'guaranteed_amount', label: 'Guaranteed Amount (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 30),

  T('credit-card-facility', 'Corporate Credit Card Facility', 'Board Resolution', 'Loans & Credit',
    'Authorize a corporate credit card facility and designate cardholders.',
    `RESOLVED, that the Corporation apply for and accept a corporate credit card facility with {{issuer_name}} with a credit limit of {{credit_limit}}, and that the following be issued cards as authorized cardholders: {{cardholders}}. {{signatory_name}} is hereby authorized to execute all documents necessary to consummate said facility.`,
    [
      { key: 'issuer_name', label: 'Card Issuer', type: 'text', required: true },
      { key: 'credit_limit', label: 'Credit Limit (PHP)', type: 'text', required: true },
      { key: 'cardholders', label: 'Cardholders (one per line)', type: 'textarea', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 40),

  // Real Estate
  T('acquire-real-property', 'Acquire Real Property', 'Board Resolution', 'Real Estate',
    'Authorize the purchase of real property.',
    `RESOLVED, that the Corporation acquire the real property described as {{property_description}}, located at {{property_address}}, from {{seller_name}} for a consideration of {{purchase_price}}, and that {{signatory_name}} be and is hereby authorized to negotiate, sign, and deliver the deed of absolute sale and all related documents.`,
    [
      { key: 'property_description', label: 'Property Description (TCT/CCT no.)', type: 'textarea', required: true },
      { key: 'property_address', label: 'Property Address', type: 'text', required: true },
      { key: 'seller_name', label: 'Seller', type: 'text', required: true },
      { key: 'purchase_price', label: 'Purchase Price (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 10),

  T('sell-real-property', 'Sell Real Property', 'Board Resolution', 'Real Estate',
    'Authorize the sale of corporate real property.',
    `RESOLVED, that the Corporation sell, transfer, and convey the real property described as {{property_description}} to {{buyer_name}} for a consideration of {{sale_price}}, and that {{signatory_name}} be and is hereby authorized to sign and deliver the deed of absolute sale and all related documents.`,
    [
      { key: 'property_description', label: 'Property Description (TCT/CCT no.)', type: 'textarea', required: true },
      { key: 'buyer_name', label: 'Buyer', type: 'text', required: true },
      { key: 'sale_price', label: 'Sale Price (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 20),

  T('lease-as-lessor', 'Lease (as Lessor)', 'Board Resolution', 'Real Estate',
    'Authorize the Corporation to lease out its real property.',
    `RESOLVED, that the Corporation lease to {{lessee_name}} the premises described as {{premises}} for a term of {{term}} commencing {{start_date}}, at a monthly rental of {{monthly_rental}}, and that {{signatory_name}} be and is hereby authorized to sign and deliver the lease agreement and any related documents.`,
    [
      { key: 'lessee_name', label: 'Lessee', type: 'text', required: true },
      { key: 'premises', label: 'Premises Description', type: 'textarea', required: true },
      { key: 'term', label: 'Lease Term', type: 'text', required: true },
      { key: 'start_date', label: 'Commencement Date', type: 'date', required: true },
      { key: 'monthly_rental', label: 'Monthly Rental (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 30),

  T('lease-as-lessee', 'Lease (as Lessee)', 'Board Resolution', 'Real Estate',
    'Authorize the Corporation to lease premises from a third party.',
    `RESOLVED, that the Corporation lease from {{lessor_name}} the premises described as {{premises}} for a term of {{term}} commencing {{start_date}}, at a monthly rental of {{monthly_rental}}, and that {{signatory_name}} be and is hereby authorized to sign and deliver the lease agreement.`,
    [
      { key: 'lessor_name', label: 'Lessor', type: 'text', required: true },
      { key: 'premises', label: 'Premises Description', type: 'textarea', required: true },
      { key: 'term', label: 'Lease Term', type: 'text', required: true },
      { key: 'start_date', label: 'Commencement Date', type: 'date', required: true },
      { key: 'monthly_rental', label: 'Monthly Rental (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 40),

  T('real-estate-mortgage', 'Real Estate Mortgage', 'Board Resolution', 'Real Estate',
    'Authorize a real estate mortgage over corporate property.',
    `RESOLVED, that the Corporation constitute a real estate mortgage over the property described as {{property_description}} in favor of {{mortgagee_name}} to secure the obligation in the amount of {{secured_amount}}, and that {{signatory_name}} be and is hereby authorized to sign and deliver the mortgage instrument and all related documents.`,
    [
      { key: 'property_description', label: 'Property Description', type: 'textarea', required: true },
      { key: 'mortgagee_name', label: 'Mortgagee', type: 'text', required: true },
      { key: 'secured_amount', label: 'Secured Amount (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 50),

  // Corporate Governance
  T('election-of-officers', 'Election of Officers', 'Board Resolution', 'Corporate Governance',
    'Elect the corporate officers for the ensuing year.',
    `RESOLVED, that the following individuals be and are hereby elected to the corresponding offices of the Corporation, to serve for the ensuing year and until their successors are duly elected and qualified:\n\n{{officer_slate}}`,
    [
      { key: 'officer_slate', label: 'Officer Slate (one per line: Position — Name)', type: 'textarea', required: true },
    ], 10),

  T('resignation-of-officer', 'Resignation of Officer / Director', 'Board Resolution', 'Corporate Governance',
    'Accept the resignation of a director or officer.',
    `RESOLVED, that the resignation of {{person_name}}, as {{position}} of the Corporation, effective {{effective_date}}, be and is hereby accepted with thanks for services rendered.`,
    [
      { key: 'person_name', label: 'Resigning Person', type: 'text', required: true },
      { key: 'position', label: 'Position', type: 'text', required: true },
      { key: 'effective_date', label: 'Effective Date', type: 'date', required: true },
    ], 20),

  T('fill-vacancy', 'Fill Vacancy in the Board', 'Board Resolution', 'Corporate Governance',
    'Fill a vacancy in the Board of Directors.',
    `RESOLVED, that {{new_director_name}} be and is hereby elected as Director of the Corporation to fill the vacancy created by the {{vacancy_cause}} of {{outgoing_director_name}}, to serve the unexpired term of the latter.`,
    [
      { key: 'new_director_name', label: 'New Director', type: 'text', required: true },
      { key: 'vacancy_cause', label: 'Cause of Vacancy', type: 'select', required: true, options: ['resignation', 'death', 'removal', 'incapacity'] },
      { key: 'outgoing_director_name', label: 'Outgoing Director', type: 'text', required: true },
    ], 30),

  T('change-principal-office', 'Change of Principal Office', 'Board Resolution', 'Corporate Governance',
    'Authorize the change of the Corporation\'s principal office address.',
    `RESOLVED, that the principal office of the Corporation be transferred from {{old_address}} to {{new_address}}, effective {{effective_date}}, and that {{signatory_name}} be and is hereby authorized to file all amendments and notices necessary with the Securities and Exchange Commission and other government agencies.`,
    [
      { key: 'old_address', label: 'Old Address', type: 'textarea', required: true },
      { key: 'new_address', label: 'New Address', type: 'textarea', required: true },
      { key: 'effective_date', label: 'Effective Date', type: 'date', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 40),

  T('change-corporate-name', 'Change of Corporate Name', 'Board Resolution', 'Corporate Governance',
    'Authorize an amendment changing the corporate name (subject to stockholder ratification).',
    `RESOLVED, that, subject to the approval of stockholders representing at least two-thirds of the outstanding capital stock and the Securities and Exchange Commission, the corporate name be changed from "{{old_name}}" to "{{new_name}}," and that {{signatory_name}} be and is hereby authorized to prepare, sign, and file all amendments and supporting documents necessary therefor.`,
    [
      { key: 'old_name', label: 'Current Name', type: 'text', required: true },
      { key: 'new_name', label: 'Proposed New Name', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 50),

  T('amend-articles', 'Amendment of Articles of Incorporation', 'Board Resolution', 'Corporate Governance',
    'Recommend specific amendments to the Articles for stockholder approval.',
    `RESOLVED, that, subject to the approval of stockholders representing at least two-thirds of the outstanding capital stock and the Securities and Exchange Commission, the Articles of Incorporation be amended as follows: {{amendment_text}}. And that {{signatory_name}} be and is hereby authorized to file all amendments and supporting documents necessary therefor.`,
    [
      { key: 'amendment_text', label: 'Amendment Text', type: 'textarea', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 60),

  T('amend-bylaws', 'Amendment of By-Laws', 'Board Resolution', 'Corporate Governance',
    'Recommend specific amendments to the By-Laws.',
    `RESOLVED, that, subject to the approval of stockholders representing the majority of the outstanding capital stock and the Securities and Exchange Commission, the By-Laws be amended as follows: {{amendment_text}}. And that {{signatory_name}} be and is hereby authorized to file all amendments necessary therefor.`,
    [
      { key: 'amendment_text', label: 'Amendment Text', type: 'textarea', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 70),

  T('general-signatory-designation', 'Designate Corporate Signatory (General)', 'Board Resolution', 'Corporate Governance',
    'Designate a general signatory for routine corporate transactions.',
    `RESOLVED, that {{signatory_name}}, in his/her capacity as {{signatory_position}}, be and is hereby authorized to sign for and on behalf of the Corporation any and all documents related to {{scope}}, including but not limited to contracts, applications, and government filings, until this authority is revoked or modified by the Board.`,
    [
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
      { key: 'signatory_position', label: 'Position', type: 'text', required: true },
      { key: 'scope', label: 'Scope of Authority', type: 'textarea', required: true },
    ], 80),

  // Capital & Shares
  T('increase-acs', 'Increase Authorized Capital Stock', 'Board Resolution', 'Capital & Shares',
    'Recommend an increase in authorized capital stock for stockholder approval.',
    `RESOLVED, that, subject to the approval of stockholders representing at least two-thirds of the outstanding capital stock and the Securities and Exchange Commission, the authorized capital stock of the Corporation be increased from {{old_acs}} to {{new_acs}}, divided into {{new_shares}} shares with a par value of {{par_value}} each, and that {{signatory_name}} be and is hereby authorized to file all documents necessary therefor.`,
    [
      { key: 'old_acs', label: 'Current ACS (PHP)', type: 'text', required: true },
      { key: 'new_acs', label: 'New ACS (PHP)', type: 'text', required: true },
      { key: 'new_shares', label: 'New Number of Shares', type: 'text', required: true },
      { key: 'par_value', label: 'Par Value (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 10),

  T('decrease-acs', 'Decrease Authorized Capital Stock', 'Board Resolution', 'Capital & Shares',
    'Recommend a decrease in authorized capital stock for stockholder approval.',
    `RESOLVED, that, subject to the approval of stockholders representing at least two-thirds of the outstanding capital stock and the Securities and Exchange Commission, the authorized capital stock of the Corporation be decreased from {{old_acs}} to {{new_acs}}, and that {{signatory_name}} be and is hereby authorized to file all documents necessary therefor.`,
    [
      { key: 'old_acs', label: 'Current ACS (PHP)', type: 'text', required: true },
      { key: 'new_acs', label: 'New ACS (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 20),

  T('stock-issuance', 'Stock Issuance / Subscription', 'Board Resolution', 'Capital & Shares',
    'Authorize issuance of shares to a subscriber.',
    `RESOLVED, that the Corporation issue {{shares_issued}} {{share_class}} shares to {{subscriber_name}} at a subscription price of {{subscription_price}} per share, and that {{signatory_name}} be and is hereby authorized to execute the subscription agreement and issue the corresponding stock certificate(s).`,
    [
      { key: 'shares_issued', label: 'Number of Shares', type: 'text', required: true },
      { key: 'share_class', label: 'Share Class', type: 'select', required: true, options: ['common', 'preferred'] },
      { key: 'subscriber_name', label: 'Subscriber', type: 'text', required: true },
      { key: 'subscription_price', label: 'Subscription Price per Share (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 30),

  T('stock-transfer-book-entry', 'Stock Transfer Book Entry', 'Board Resolution', 'Capital & Shares',
    'Record a transfer of shares between stockholders.',
    `RESOLVED, that the transfer of {{shares_transferred}} {{share_class}} shares from {{transferor_name}} to {{transferee_name}} be and is hereby acknowledged and recorded in the Corporation's stock and transfer book, and that the corresponding stock certificate be cancelled and a new certificate be issued in favor of the transferee.`,
    [
      { key: 'shares_transferred', label: 'Number of Shares', type: 'text', required: true },
      { key: 'share_class', label: 'Share Class', type: 'text', required: true },
      { key: 'transferor_name', label: 'Transferor', type: 'text', required: true },
      { key: 'transferee_name', label: 'Transferee', type: 'text', required: true },
    ], 40),

  T('declare-cash-dividend', 'Declare Cash Dividend', 'Board Resolution', 'Capital & Shares',
    'Declare a cash dividend out of unrestricted retained earnings.',
    `RESOLVED, that out of the unrestricted retained earnings of the Corporation, a cash dividend of {{dividend_per_share}} per share be and is hereby declared in favor of stockholders of record as of {{record_date}}, payable on or before {{payment_date}}, and that {{signatory_name}} be and is hereby authorized to effect the necessary distribution.`,
    [
      { key: 'dividend_per_share', label: 'Dividend per Share (PHP)', type: 'text', required: true },
      { key: 'record_date', label: 'Record Date', type: 'date', required: true },
      { key: 'payment_date', label: 'Payment Date', type: 'date', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 50),

  T('declare-stock-dividend', 'Declare Stock Dividend', 'Board Resolution', 'Capital & Shares',
    'Declare a stock dividend (subject to stockholder approval).',
    `RESOLVED, that, subject to the approval of stockholders representing at least two-thirds of the outstanding capital stock, a stock dividend of {{dividend_rate}} be and is hereby declared in favor of stockholders of record as of {{record_date}}, payable in the form of additional {{share_class}} shares.`,
    [
      { key: 'dividend_rate', label: 'Dividend Rate (e.g. 10%)', type: 'text', required: true },
      { key: 'record_date', label: 'Record Date', type: 'date', required: true },
      { key: 'share_class', label: 'Share Class', type: 'text', required: true },
    ], 60),

  // HR
  T('hire-executive', 'Hire Executive', 'Board Resolution', 'HR',
    'Authorize the hiring of a senior executive on specified terms.',
    `RESOLVED, that {{executive_name}} be and is hereby hired as {{position}} of the Corporation, effective {{start_date}}, on the compensation and benefits described in the attached employment offer, and that {{signatory_name}} be and is hereby authorized to execute the employment contract on behalf of the Corporation.`,
    [
      { key: 'executive_name', label: 'Executive Name', type: 'text', required: true },
      { key: 'position', label: 'Position', type: 'text', required: true },
      { key: 'start_date', label: 'Start Date', type: 'date', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 10),

  T('set-executive-compensation', 'Set Executive Compensation', 'Board Resolution', 'HR',
    'Set or adjust executive compensation.',
    `RESOLVED, that the compensation of {{executive_name}}, {{position}}, be and is hereby set at {{compensation}}, effective {{effective_date}}, inclusive of {{benefits}}.`,
    [
      { key: 'executive_name', label: 'Executive Name', type: 'text', required: true },
      { key: 'position', label: 'Position', type: 'text', required: true },
      { key: 'compensation', label: 'Compensation (PHP, monthly or annual)', type: 'text', required: true },
      { key: 'effective_date', label: 'Effective Date', type: 'date', required: true },
      { key: 'benefits', label: 'Benefits Description', type: 'textarea', required: false },
    ], 20),

  T('adopt-stock-option-plan', 'Adopt Stock Option / Retirement Plan', 'Board Resolution', 'HR',
    'Adopt an equity-incentive or retirement plan.',
    `RESOLVED, that the Corporation adopt the {{plan_name}} attached hereto and made an integral part of this resolution, effective {{effective_date}}, and that {{signatory_name}} be and is hereby authorized to administer said plan and to execute all documents necessary for its implementation.`,
    [
      { key: 'plan_name', label: 'Plan Name', type: 'text', required: true },
      { key: 'effective_date', label: 'Effective Date', type: 'date', required: true },
      { key: 'signatory_name', label: 'Plan Administrator', type: 'text', required: true },
    ], 30),

  // Tax
  T('authorize-bir-representative', 'Authorize BIR Representative', 'Board Resolution', 'Tax',
    'Authorize a representative to act before the BIR.',
    `RESOLVED, that {{representative_name}} be and is hereby designated as the authorized representative of the Corporation before the Bureau of Internal Revenue, with full authority to file returns, sign documents, request rulings or refunds, and represent the Corporation in any audit, assessment, or proceeding.`,
    [
      { key: 'representative_name', label: 'Representative', type: 'text', required: true },
    ], 10),

  T('settle-tax-assessment', 'Settle Tax Assessment', 'Board Resolution', 'Tax',
    'Authorize settlement of a specific tax assessment.',
    `RESOLVED, that the Corporation settle the tax assessment issued by the {{tax_agency}} under Assessment No. {{assessment_no}} in the amount of {{settlement_amount}}, and that {{signatory_name}} be and is hereby authorized to negotiate and execute any compromise agreement and pay the resulting settlement.`,
    [
      { key: 'tax_agency', label: 'Tax Agency', type: 'text', required: true },
      { key: 'assessment_no', label: 'Assessment No.', type: 'text', required: true },
      { key: 'settlement_amount', label: 'Settlement Amount (PHP)', type: 'text', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 20),

  // Litigation
  T('authorize-filing-suit', 'Authorize Filing of Suit', 'Board Resolution', 'Litigation',
    'Authorize the Corporation to file a civil/criminal action.',
    `RESOLVED, that the Corporation file the appropriate {{case_type}} against {{defendant_name}} arising from {{cause_of_action}}, and that {{signatory_name}} be and is hereby authorized to sign the verification and certification of non-forum shopping, the complaint, and all related pleadings, and to engage counsel for that purpose.`,
    [
      { key: 'case_type', label: 'Type of Action', type: 'text', required: true },
      { key: 'defendant_name', label: 'Defendant', type: 'text', required: true },
      { key: 'cause_of_action', label: 'Cause of Action (brief)', type: 'textarea', required: true },
      { key: 'signatory_name', label: 'Authorized Representative', type: 'text', required: true },
    ], 10),

  T('authorize-compromise', 'Authorize Compromise / Settlement', 'Board Resolution', 'Litigation',
    'Authorize compromise of a pending case.',
    `RESOLVED, that the Corporation enter into a compromise agreement in the case entitled "{{case_caption}}" pending before {{court_name}}, under the terms summarized as {{compromise_terms}}, and that {{signatory_name}} be and is hereby authorized to sign and deliver said compromise agreement and any related documents.`,
    [
      { key: 'case_caption', label: 'Case Caption', type: 'text', required: true },
      { key: 'court_name', label: 'Court / Tribunal', type: 'text', required: true },
      { key: 'compromise_terms', label: 'Summary of Compromise Terms', type: 'textarea', required: true },
      { key: 'signatory_name', label: 'Authorized Signatory', type: 'text', required: true },
    ], 20),

  // Government
  T('authorize-agency-representative', 'Authorize Representative before Government Agency', 'Board Resolution', 'Government',
    'Generic authorization for a representative to transact with a named agency.',
    `RESOLVED, that {{representative_name}} be and is hereby authorized to represent the Corporation before the {{agency_name}} for purposes of {{purpose}}, with full authority to file applications, sign documents, receive notices, and transact all business incidental thereto.`,
    [
      { key: 'representative_name', label: 'Representative', type: 'text', required: true },
      { key: 'agency_name', label: 'Government Agency', type: 'text', required: true },
      { key: 'purpose', label: 'Purpose', type: 'textarea', required: true },
    ], 10),
];
