/**
 * The client-safe half of corporation-doc-extract.ts: the category table the
 * upload UI renders and the shape of an extraction result. It exists so client
 * components can import these without pulling the AI gate — and through it
 * lib/firm/features.ts and web-push — into the browser bundle, which fails the
 * production build. Same split as lib/firm/feature-shape.ts.
 */

/**
 * The registration documents worth reading on upload. Each one carries the
 * facts for a slice of the corporation record that someone would otherwise
 * retype off a scan.
 *
 * `fields` are Corporation keys accepted by the corporation PATCH route, so an
 * extraction result is a ready-to-send patch.
 */
export const EXTRACTABLE_CATEGORIES = {
  'SEC COR': {
    label: 'SEC Certificate of Incorporation',
    fields: ['approvedName', 'secRegistrationNo', 'secRegistrationDate', 'companyType'],
    guidance: `A Certificate of Incorporation issued by the Philippine SEC.
- approvedName: the corporate name EXACTLY as printed, including punctuation and suffix (Inc., Corporation, OPC).
- secRegistrationNo: the SEC registration / company registration number, e.g. CS201819425 or 2025030194341-24.
- secRegistrationDate: the date SEC registered the entity / issued the certificate.
- companyType: one of Stock, Non-Stock, OPC, Partnership. OPC when it identifies a One Person Corporation.`,
  },
  'BIR COR': {
    label: 'BIR Certificate of Registration (Form 2303)',
    fields: ['birTin', 'birRdoCode', 'birCorDate'],
    guidance: `A BIR Certificate of Registration, usually BIR Form 2303.
- birTin: the Taxpayer Identification Number, digits and dashes as printed, e.g. 483-370-384-000.
- birRdoCode: the Revenue District Office code — the numeric code only (e.g. "044"), not the district name.
- birCorDate: the date of issue of the Certificate of Registration.`,
  },
  'Business Permit': {
    label: "Mayor's / Business Permit",
    fields: ['businessPermitNo', 'businessPermitLgu', 'businessPermitIssuedDate', 'businessPermitExpiryDate'],
    guidance: `A Mayor's Permit / Business Permit issued by a Philippine city or municipality.
- businessPermitNo: the permit or plate number as printed.
- businessPermitLgu: the issuing city or municipality, e.g. "Quezon City" or "Makati City".
- businessPermitIssuedDate: the date of issue.
- businessPermitExpiryDate: the validity / expiry date. Philippine business permits normally expire 31 December of the year of issue — use that only if the document itself says so, otherwise null.`,
  },
  'SSS R-1': {
    label: 'SSS Employer Registration (R-1)',
    fields: ['sssEmployerNo', 'sssRegistrationDate'],
    guidance: `An SSS employer registration form (R-1) or certificate.
- sssEmployerNo: the SSS employer number as printed, e.g. 03-9123456-7.
- sssRegistrationDate: the date of registration or issue.`,
  },
  'PhilHealth ER1': {
    label: 'PhilHealth Employer Registration (ER1)',
    fields: ['philhealthEmployerNo', 'philhealthRegistrationDate'],
    guidance: `A PhilHealth employer registration form (ER1) or Certificate of Registration.
- philhealthEmployerNo: the PhilHealth Employer Number (PEN) as printed.
- philhealthRegistrationDate: the date of registration or issue.`,
  },
  'Pag-IBIG EFR': {
    label: 'Pag-IBIG Employer Registration',
    fields: ['pagibigEmployerNo', 'pagibigRegistrationDate'],
    guidance: `A Pag-IBIG Fund employer registration (EFR) or Certificate of Registration.
- pagibigEmployerNo: the Pag-IBIG employer ID as printed.
- pagibigRegistrationDate: the date of registration or issue.`,
  },
} as const;

export type ExtractableCategory = keyof typeof EXTRACTABLE_CATEGORIES;

export function isExtractable(category: string): category is ExtractableCategory {
  return category in EXTRACTABLE_CATEGORIES;
}

/** Field values read off a document, keyed by Corporation field name. */
export type ExtractedFields = Record<string, string | null>;

export interface DocumentExtraction {
  category: ExtractableCategory;
  /** The model's read on whether the document really is what it was filed as. */
  isExpectedDocument: boolean;
  fields: ExtractedFields;
  notes: string;
}
