/**
 * Seed script: the Trademark Prosecution Playbook, as a Library handbook page.
 *
 * Usage: npx tsx scripts/seed-playbook-trademark.ts <firmIdOrSlug> [--force]
 *
 * Takes the firm explicitly and writes through `getServiceDbForFirm`, which
 * stamps `firm_id` — `kb_pages.firm_id` is NOT NULL with no default, so the
 * unscoped raw client this used to build raised 23502. An existing row is left
 * alone unless `--force` is passed, so a re-run is a no-op.
 */

import { runSeed } from './resource-seed';

const CONTENT = `
<p><em>Taking a mark from clearance search to registration and keeping it alive. Trademark work is small in volume and unforgiving in deadlines — a missed Declaration of Actual Use kills a registration the client paid years to obtain, and it cannot be revived.</em></p>

<blockquote>
<p><strong>Verify before you rely.</strong> Every <strong>deadline period in the two tables below</strong> was checked against the IP Code and the 2023 Trademark Regulations in August 2026 and corrected in code where it was wrong. The rest of this page — clearance, classification, opposition strategy, the fee guidance — still reflects how the firm has been running these matters and has <strong>not</strong> been checked. IPOPHL amends its regulations and fee schedules regularly. Confirm before calendaring anything unusual.</p>
</blockquote>

<h1>What Lumilex already does for you</h1>
<p>The trademark record computes its own deadlines and surfaces the next one on the dashboard. Each is modelled as a <strong>window</strong> rather than a single date — an opening, a bar date, and where one exists, an extended bar date:</p>

<table>
<thead><tr><th>Deadline</th><th>Window opens</th><th>Due (bar date)</th><th>Extendible to</th></tr></thead>
<tbody>
<tr><td>Issuance / publication fees</td><td>—</td><td>NOA/NOI date + 2 months</td><td>Not extendible</td></tr>
<tr><td>Office Action response</td><td>—</td><td>OA receipt + 2 months</td><td>+ 2 months, on request and fee</td></tr>
<tr><td>3rd-year DAU</td><td>—</td><td><strong>Filing</strong> date + 3 years</td><td>+ 6 months, on request and fee</td></tr>
<tr><td>5th-year DAU</td><td><strong>Registration</strong> + 5 years</td><td><strong>Registration</strong> + 6 years</td><td>Not extendible</td></tr>
<tr><td>Renewal</td><td>Registration + 9½ years</td><td>Registration + 10 years</td><td>+ 6 months, with surcharge</td></tr>
<tr><td>Renewal DAU</td><td>Renewal date</td><td>Renewal date + 1 year</td><td>Not extendible</td></tr>
<tr><td>Renewal 5-DAU</td><td>Renewal date + 5 years</td><td>Renewal date + 6 years</td><td>Not extendible</td></tr>
</tbody>
</table>

<p>The last two appear only once a <strong>renewal filing date</strong> is recorded on the mark — an unrenewed registration does not owe them yet. "Renewal date" means the date the renewed term begins, which is the previous term's expiry (registration + 10 years); filing the request early does not move these deadlines forward.</p>

<h3>How to read the computed dates</h3>
<ol>
<li><strong>The 5th-year DAU anchor was wrong, and has been corrected.</strong> IP Code sec. 145 gives one year <em>from the fifth anniversary of the date of the registration</em>, so the window opens at registration + 5 years and closes at registration + 6 years. Lumilex previously anchored it to the <strong>filing</strong> date, which showed a date one to two years early on every registered mark. <strong>If you calendared a 5th-year DAU from the dashboard before August 2026, re-check it</strong> — the date has moved later, and any client reported to on the old figure was given a date that was not the deadline.</li>
<li><strong>A filed-but-unregistered mark has no 5th-year DAU at all.</strong> The obligation does not exist until the certificate issues, so the deadline now appears only once the registration date is recorded. It will no longer show against pending applications.</li>
<li><strong>The opening date is a real constraint.</strong> IPOPHL will not accept a 5th-year DAU before the fifth anniversary, nor a renewal more than six months before expiry. The deadlines list shows an <strong>Opens</strong> date while that day is still in the future — a mark sitting there is not yet actionable, however close the due date looks.</li>
<li><strong>An extension is never automatic.</strong> Where the dashboard shows <em>Ext.</em>, the extension must be <strong>requested before the original due date</strong>, with the fee — the request is itself a deadline, and it is the one people miss. Where it shows <em>Late to</em>, no advance request is needed but a surcharge is. The 5th-year DAU shows neither: it cannot be extended at all.</li>
</ol>

<hr>

<h1>Stage 1 — Before filing</h1>
<p>This is where the firm adds the most value and where the least time usually gets spent.</p>
<ul>
<li><strong>Clearance search</strong> against the IPOPHL database for identical and confusingly similar marks in the relevant and neighbouring classes. Search the mark as it will be used, not only as it will be written.</li>
<li><strong>Advise on the search in writing</strong>, including the marks that came close. A clearance opinion that lists only the conclusion is worth nothing when an opposition arrives.</li>
<li><strong>Classification.</strong> Confirm the Nice classes and the specification of goods and services. Over-broad specifications invite oppositions and create a use problem at DAU time — the client must actually use the mark on what was specified.</li>
<li><strong>Confirm the applicant.</strong> The entity that will own and use the mark, with its exact registered name. Correcting an applicant later is expensive.</li>
<li><strong>Confirm actual or intended use</strong>, and tell the client plainly, at this stage, that a Declaration of Actual Use with proof will fall due and that a mark not in use will be removed.</li>
<li><strong>Consider the filing route</strong> — direct national filing versus the Madrid Protocol where the client wants protection in multiple countries.</li>
</ul>

<h2>The conversation to have at engagement</h2>
<p>Every trademark client should hear these four things before they pay a filing fee, and should hear them again in writing:</p>
<ol>
<li>Registration takes time, and an opposition can extend it considerably.</li>
<li>A registration must be <strong>maintained by declarations of use</strong>, at the third year and again around the fifth, and then on renewal. These are not optional and cannot be cured after the fact.</li>
<li><strong>Keep dated proof of use</strong> from day one — labels, packaging, signage, invoices, screenshots with dates. Clients who start looking for proof when the DAU falls due usually cannot find any.</li>
<li>Registration in one class does not protect goods in another.</li>
</ol>

<hr>

<h1>Stage 2 — Filing to registration</h1>

<table>
<thead><tr><th>Stage</th><th>What happens</th><th>Our move</th></tr></thead>
<tbody>
<tr><td>Filing</td><td>Application filed; filing date established</td><td>Record the filing date in Lumilex — it anchors the 3rd-year DAU</td></tr>
<tr><td>Formality examination</td><td>IPOPHL checks completeness</td><td>Cure formal defects promptly; they are cheap to fix and expensive to ignore</td></tr>
<tr><td>Substantive examination</td><td>Examiner assesses registrability and conflicts</td><td>—</td></tr>
<tr><td><strong>Office Action</strong></td><td>Refusal or requirement issued</td><td><strong>Response due 2 months from receipt</strong>, extendible by a further 2 months on request and fee. The request must be filed <em>before</em> the original 2 months lapse — Lumilex shows the extended date, but it will not chase the request for you.</td></tr>
<tr><td>Publication</td><td>Mark published in the IPOPHL e-Gazette for opposition</td><td>Diarise the opposition window's close</td></tr>
<tr><td><strong>Opposition period</strong></td><td>Third parties may oppose</td><td>If opposed, this becomes a contested proceeding — escalate to a partner and rescope the engagement. Do not absorb an opposition inside a prosecution fee.</td></tr>
<tr><td>Allowance / Notice of Issuance</td><td>Publication and issuance fees fall due</td><td><strong>2 months from the notice</strong>, not extendible. This is the last gate: an unpaid issuance fee loses the application after examination, publication, and the opposition window have all been survived. Pay it early.</td></tr>
<tr><td>Registration</td><td>Certificate issues</td><td><strong>Record the registration date the day you have it.</strong> It anchors both the renewal and the 5th-year DAU, and until it is recorded neither deadline exists in the system at all.</td></tr>
</tbody>
</table>

<h2>Responding to an Office Action</h2>
<ul>
<li>Read what the examiner actually refused. Most responses fail because they argue a point that was not raised.</li>
<li>Where the refusal is based on a cited prior mark, the options are argument on dissimilarity, amendment of the specification, consent or coexistence from the prior owner, or challenge to the cited mark. Advise on the cost of each, not just the merits.</li>
<li>Where the refusal is descriptiveness, evidence of acquired distinctiveness is a long road — set expectations before starting it.</li>
<li><strong>Send the client the office action itself</strong>, not only your summary of it.</li>
</ul>

<hr>

<h1>Stage 3 — Maintaining the registration</h1>
<p>This is where registrations are lost, and it is entirely preventable.</p>

<table>
<thead><tr><th>Obligation</th><th>Window</th><th>Consequence of missing it</th></tr></thead>
<tbody>
<tr><td><strong>3rd-year DAU</strong></td><td>Within 3 years of the <strong>filing</strong> date (IP Code sec. 124.2). Extendible by 6 months, on a request filed before the 3 years lapse, with the fee</td><td>Application refused / registration removed</td></tr>
<tr><td><strong>5th-year DAU</strong></td><td>Within one year <strong>from the fifth anniversary of registration</strong> (IP Code sec. 145) — so between registration + 5 years and registration + 6 years. <strong>Not extendible.</strong> Cannot be filed early</td><td>Registration removed from the Register</td></tr>
<tr><td><strong>Renewal</strong></td><td>10 years from registration (IP Code sec. 146.2). Filed within the 6 months <em>before</em> expiry, or within 6 months <em>after</em> on payment of the surcharge</td><td>Registration lapses</td></tr>
<tr><td><strong>DAU following renewal</strong></td><td>Within one year <strong>from the date of renewal</strong> — the date the renewed term begins, i.e. the previous term's expiry, not the day the request was filed (IPOPHL MC 17-010 rule 204, as amended). <strong>Not extendible</strong></td><td>Registration removed</td></tr>
<tr><td><strong>Renewal 5th-year DAU</strong></td><td>Within one year from the <strong>fifth anniversary of each renewal</strong> — same rule 204. <strong>Not extendible</strong></td><td>Registration removed</td></tr>
</tbody>
</table>

<h2>What a DAU actually requires</h2>
<ul>
<li>A declaration of <strong>actual use in commerce in the Philippines</strong>, with proof — not a statement of intent, and not use abroad.</li>
<li>Evidence showing the mark <strong>as registered</strong>, on the <strong>goods or services as specified</strong>. A mark used in a materially different form, or on goods outside the specification, does not support the declaration.</li>
<li>Where the mark is genuinely not in use, there may be a basis to excuse non-use — that is a partner conversation, and it is not the default answer.</li>
</ul>

<h2>Standing rules</h2>
<ul>
<li><strong>Start the DAU six months before the deadline</strong>, not six weeks. Collecting usable proof of use from a client is the slow part, every time.</li>
<li><strong>Record the renewal filing the day it goes in.</strong> The two renewal declarations only appear on the dashboard once a renewal filing date exists on the mark — until then Lumilex has no way to know the registration was renewed, and both deadlines stay invisible.</li>
<li><strong>Send the client an annual portfolio statement</strong> — every mark, its status, and its next deadline. This is also the moment clients remember marks they never told us about.</li>
<li><strong>An opposition or cancellation is a new matter</strong>, scoped and billed separately.</li>
<li><strong>Every certificate, office action, and filed declaration is uploaded to the matter</strong> on receipt.</li>
</ul>

<hr>

<h1>Maintaining this playbook</h1>
<p>IPOPHL amends its regulations and fee schedules regularly. When something changes, edit this page and note what was verified and when.</p>
<p><strong>Closed in August 2026:</strong> the 5th-year DAU anchor (moved from filing to registration); the modelling of deadlines as windows with opening dates and extension periods; and the issuance fee period, corrected from 4 months to <strong>2</strong>. The old 4-month figure came across from the Notion model and ran two months <em>late</em> — the dangerous direction, and the only error found on this page that did. All three are now in the code and reflected in the tables above.</p>
<p>Also closed in August 2026: <strong>the two renewal declarations are now computed</strong> and appear on the deadlines dashboard, with "Mark Filed" actions on the trademark page. They are no longer a manual diary entry. Rule 204's four DAU deadlines are now all modelled — third year, fifth year, following renewal, and the fifth anniversary of renewal.</p>
<p>Note on terminology: the firm treats the <strong>Notice of Allowance and the Notice of Issuance as the same event</strong>. Lumilex records it once, as the NOI date, and the trademark timeline's separate "NOA Received" step is a legacy artefact of the Notion import rather than a second deadline.</p>
<p><strong>Still open:</strong></p>
<ul>
<li><strong>Only the first renewal cycle is modelled.</strong> Lumilex records one renewal per mark, so the declarations following a <em>second</em> renewal — at forty and forty-five years from registration — cannot be represented. No mark in the portfolio is near this, but a mark taken over from another firm might be. Diarise those by hand.</li>
<li><strong>The renewal anchor should be confirmed with IPOPHL.</strong> Rule 204 says "from the date of renewal". Lumilex reads that as the date the renewed term begins — the previous term's expiry — on the basis that IP Code sec. 146.1 renews the registration "at its expiration", so filing early does not bring the renewal forward. If IPOPHL instead dates a renewal from its grant, the two renewal declarations would fall due earlier than shown. Worth settling before the first renewal in the portfolio, which is due 2031.</li>
</ul>
`.trim();

const EXCERPT =
  'Taking a mark from clearance search to registration and keeping it alive — the prosecution stages, the maintenance declarations that lose registrations when missed, and what the computed deadlines in Lumilex do and do not tell you.';

runSeed('seed-playbook-trademark', {
  slug: 'playbook-trademark',
  title: 'Trademark Prosecution Playbook',
  excerpt: EXCERPT,
  content: CONTENT,
});
