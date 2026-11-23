/**
 * Seed script: the Corporate Compliance Calendar playbook, as a Library handbook page.
 *
 * Usage: npx tsx scripts/seed-playbook-corporate-compliance.ts <firmIdOrSlug> [--force]
 *
 * Takes the firm explicitly and writes through `getServiceDbForFirm`, which
 * stamps `firm_id` — `kb_pages.firm_id` is NOT NULL with no default, so the
 * unscoped raw client this used to build raised 23502. An existing row is left
 * alone unless `--force` is passed, so a re-run is a no-op.
 */

import { runSeed } from './resource-seed';

const CONTENT = `
<p><em>The recurring obligations of every corporation the firm keeps compliant, who does them, and when. Corporate secretarial work is low-volume and high-consequence: nobody thanks you for a GIS filed on time, and a missed one compounds quietly for years.</em></p>

<blockquote>
<p><strong>Verify before you rely.</strong> Filing deadlines, forms, and fees in this calendar are stated as the firm understands them and have <strong>not</strong> been checked against current SEC, BIR, or LGU issuances. Tax administration in particular has changed materially since 2024. Confirm against the current issuance before filing or advising.</p>
</blockquote>

<h1>How the calendar works</h1>
<p>Lumilex generates compliance deliverables automatically when a corporation receives its SEC Certificate of Registration — but only for <strong>year one</strong>. Everything in the recurring cycle below is currently the responsibility of the assigned lawyer to calendar. Until that changes, this page is the system of record for years two onward.</p>

<h2>Two problems with the generated year-1 set — both now fixed</h2>
<p>Both were verified against the primary sources and corrected in the generator. Recorded here so nobody re-derives them, and because corporations registered before the fix still carry the old deliverables:</p>
<ol>
<li><strong>The BIR annual registration fee is repealed. Confirmed.</strong> Section 34 of the <strong>Ease of Paying Taxes Act (RA 11976, enacted 5 January 2024)</strong> rewrote Section 236 of the Tax Code: the old Section 236(B) "Annual Registration Fee" is gone — subsection (B) is now "Registration of Each Type of Internal Revenue Tax" — and the phrase "registration fee" appears nowhere in the Act. The BIR <strong>ceased collecting the ₱500 fee on 22 January 2024</strong> (RMC 91-2024, clarifying RR 7-2024 as amended by RR 11-2024); a Certificate of Registration still showing the fee as a tax type <strong>retains its validity and need not be replaced</strong>. The generator no longer produces a "BIR 0605" deliverable. <strong>Corporations registered before this fix still have one on their compliance list — close it, and do not bill against it.</strong></li>
<li><strong>The GIS due date is now anchored to the meeting.</strong> The GIS falls due within <strong>30 calendar days of the annual stockholders' or members' meeting actually held</strong> (SEC MC 01-2025), and the Revised Corporation Code §49 puts that meeting on the date fixed in the by-laws — or, absent one, any board-determined date after 15 April. Fiscal year end never set it. The corporation record now carries the by-laws meeting date as a <strong>Meeting Month</strong> and <strong>Meeting Day</strong> (Overview tab, under Contact &amp; Filing Details); fill both in and the generated GIS deadline is computed from the meeting that follows the fiscal year being reported on. <strong>Leave either blank and the system falls back to the old fiscal-year-end + 30 heuristic, which is a placeholder — reset it to 30 days after the actual meeting date.</strong></li>
</ol>
<p>Reading the by-laws' meeting date into the record is therefore part of onboarding, not an optional extra: it is the only input that makes the GIS deadline real.</p>

<hr>

<h1>The annual cycle</h1>
<p>Ordered by when they fall, for a corporation on a calendar fiscal year. Adjust for a non-calendar fiscal year — several of these move with it and several do not.</p>

<table>
<thead><tr><th>When</th><th>Obligation</th><th>Agency</th><th>Owner</th></tr></thead>
<tbody>
<tr><td>By 20 January</td><td><strong>Business permit renewal</strong> (mayor's permit), with barangay clearance, sanitary permit, fire safety inspection certificate</td><td>LGU</td><td>Liaison, with lawyer oversight</td></tr>
<tr><td>January</td><td>Registration of <strong>books of accounts</strong> for the new year, where still required in the client's form of bookkeeping</td><td>BIR</td><td>Client accountant; we confirm</td></tr>
<tr><td>Quarterly</td><td>Quarterly income tax and VAT/percentage tax returns</td><td>BIR</td><td>Client accountant; we track only</td></tr>
<tr><td>Monthly / quarterly</td><td>Withholding tax returns and alphalists; SSS, PhilHealth, and Pag-IBIG remittances</td><td>BIR / agencies</td><td>Client; we track only</td></tr>
<tr><td>Per by-laws</td><td><strong>Annual stockholders' / members' meeting</strong> — notice, quorum, minutes, election of directors</td><td>—</td><td><strong>Firm — corporate secretary work</strong></td></tr>
<tr><td>Within 30 days of that meeting</td><td><strong>General Information Sheet (GIS)</strong>, including beneficial ownership disclosure</td><td>SEC</td><td><strong>Firm</strong></td></tr>
<tr><td>15 April (calendar FY)</td><td>Annual income tax return, with audited financial statements attached</td><td>BIR</td><td>Client accountant; we confirm filing</td></tr>
<tr><td>April–June, by SEC reg. no.</td><td><strong>Audited Financial Statements (AFS)</strong>, on the SEC staggered schedule</td><td>SEC</td><td><strong>Firm</strong>, on the client's audited figures</td></tr>
<tr><td>Ongoing</td><td>Maintain the official email address and mobile number on record; report changes</td><td>SEC</td><td><strong>Firm</strong></td></tr>
</tbody>
</table>

<h2>The AFS staggered schedule</h2>
<p>The SEC sets AFS filing windows by the <strong>last digit of the SEC registration number</strong>, spread across April to June. Lumilex implements this schedule when it generates the year-1 AFS deliverable. Two cautions:</p>
<ul>
<li>The schedule is <strong>reissued annually</strong> by SEC circular and the dates move. Confirm the current year's circular rather than trusting last year's dates or the generated one.</li>
<li>Corporations whose securities are publicly held, and those with fiscal years ending other than 31 December, are on different rules.</li>
</ul>

<h2>Events that create obligations outside the cycle</h2>
<p>Each of these is a filing, and each has a clock. When any of them happens, open a Post-Incorporation or Corporate Housekeeping matter — do not handle it as an unbilled favour inside a retainer:</p>
<ul>
<li>Change of directors, officers, or corporate secretary</li>
<li>Change of principal office address</li>
<li>Amendment of articles or by-laws</li>
<li>Increase or decrease of authorised capital stock</li>
<li>Transfer of shares — stock and transfer book entries, and the tax consequences</li>
<li>Change of corporate name</li>
<li>Change of fiscal year</li>
<li>Opening or closing a branch</li>
<li>Beneficial ownership changes requiring an updated disclosure</li>
<li>Dissolution, merger, or consolidation</li>
</ul>

<hr>

<h1>Onboarding a corporation into compliance</h1>
<p>Run this when the firm takes over corporate secretarial work for an existing corporation. Assume nothing about what the previous handler did.</p>
<ol>
<li><strong>Pull the SEC file.</strong> Articles, by-laws, all amendments, and the last three years of GIS and AFS filings.</li>
<li><strong>Establish what is late.</strong> Missed GIS and AFS filings accrue penalties that grow with time and do not go away. Quantify the exposure and put it in writing to the client before agreeing a scope.</li>
<li><strong>Reconcile the record</strong> — do the directors and officers on the last GIS match reality? Does the stock and transfer book match the GIS?</li>
<li><strong>Confirm the by-laws' meeting date</strong>, because it anchors the GIS deadline.</li>
<li><strong>Confirm the fiscal year end</strong>, because it anchors everything else.</li>
<li><strong>Check the official email address on record with the SEC</strong> — notices go there, and a stale address means the client is not receiving them.</li>
<li><strong>Create the corporation record in Lumilex</strong> with the registration number, registration date, fiscal year end, and the by-laws meeting month and day, so the deadline engine has correct inputs.</li>
<li><strong>Calendar the full annual cycle</strong> as deliverables, not just year one.</li>
</ol>

<h1>Standing rules</h1>
<ul>
<li><strong>Never file a GIS off stale information.</strong> Confirm directors, officers, and shareholdings with the client in writing each year, even when nothing has changed. The confirmation email is the file note that protects the firm.</li>
<li><strong>Beneficial ownership is not optional and is not the client's guess.</strong> If the client cannot identify ultimate beneficial owners, escalate — that is a substantive problem, not a form-filling one.</li>
<li><strong>We do not prepare the financial statements.</strong> We file what the client's auditor produces. If the audited statements are late, the SEC deadline still runs — chase the auditor in writing, early, and copy the client.</li>
<li><strong>Penalties are the client's, but the missed deadline is ours.</strong> Any missed statutory filing is reported to a partner the day it is discovered.</li>
<li><strong>Every filing gets its filed copy uploaded</strong> to the matter. A filing with no proof of filing in the record is, for our purposes, not filed.</li>
</ul>

<h1>Maintaining this calendar</h1>
<p>SEC and BIR issuances change these dates. When one changes, edit this page and note what changed and when it was verified. The correct long-term fix for the recurring cycle is to extend the deadline generator beyond year one — until that ships, this page carries the load.</p>
`.trim();

const EXCERPT =
  'The recurring SEC, BIR, and LGU obligations for every corporation the firm keeps compliant — the annual cycle, the events that create filings outside it, and the onboarding run for taking over an existing corporation.';

runSeed('seed-playbook-corporate-compliance', {
  slug: 'playbook-corporate-compliance',
  title: 'Corporate Compliance Calendar',
  excerpt: EXCERPT,
  content: CONTENT,
});
