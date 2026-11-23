/**
 * Seed script: the Litigation Playbook, as a Library handbook page.
 *
 * Usage: npx tsx scripts/seed-playbook-litigation.ts <firmIdOrSlug> [--force]
 *
 * Takes the firm explicitly and writes through `getServiceDbForFirm`, which
 * stamps `firm_id` — `kb_pages.firm_id` is NOT NULL with no default, so the
 * unscoped raw client this used to build raised 23502. An existing row is left
 * alone unless `--force` is passed, so a re-run is a no-op.
 */

import { runSeed } from './resource-seed';

const CONTENT = `
<p><em>How the firm runs a case, track by track. Covers the three forums that carry our litigation volume: criminal preliminary investigation, labor, and regular civil actions.</em></p>

<blockquote>
<p><strong>Verify before you rely.</strong> Every period and authority in this playbook is stated as the firm understands it and has <strong>not</strong> been checked against a current official text. Procedural rules change — the 2019 amendments to the Rules of Civil Procedure reset half the civil periods, and the DOJ has since reissued its preliminary-investigation rules. Confirm the governing rule before you calendar a deadline off this page.</p>
</blockquote>

<h1>How to use this</h1>
<p>Each track below gives you five things: <strong>when it applies</strong>, an <strong>intake checklist</strong> to run before the first pleading, the <strong>procedural spine</strong> with its deadlines, the <strong>deliverable chain</strong> to create in Lumilex, and the <strong>failure modes</strong> that actually lose these cases.</p>
<p>The playbook is a floor, not a ceiling. It tells you what must happen; it does not tell you what to argue.</p>

<h2>Firm gates that apply to every track</h2>
<ul>
<li><strong>Conflicts first.</strong> Run the conflicts check before the engagement letter, not after the complaint is drafted.</li>
<li><strong>Every Judicial Affidavit goes through Affidavit Review.</strong> Judicial Affidavits are the single largest category of work product this firm produces. Run <em>Self-review</em> mode on ours before it is finalized, and <em>Opposing JA</em> mode on theirs the day it is received.</li>
<li><strong>Every substantive pleading goes through Red Team before it leaves Pre-finalized.</strong> Link the matter — an unlinked run cannot compare the draft against the case record, which is where the contradictions are.</li>
<li><strong>Deadlines are calendared the day the order or resolution is received</strong>, by whoever receives it, not by the drafter. A period that exists only in someone's head is not a period.</li>
<li><strong>Status report to the client within 48 hours of any adverse order</strong>, and before the client hears it from anyone else.</li>
</ul>

<hr>

<h1>Track 1 — Criminal complaints and preliminary investigation</h1>
<p><em>Office of the City/Provincial Prosecutor, NPS, DOJ, NBI. Our largest litigation cluster.</em></p>

<h2>When this applies</h2>
<p>Any matter that begins with a criminal complaint — whether we file it for a complainant or defend a respondent. It ends when an Information is filed in court (at which point the matter converts to a criminal case before the trial court) or the complaint is dismissed with finality.</p>

<h2>Intake checklist</h2>
<ul>
<li><strong>Which side.</strong> Complainant and respondent run on entirely different clocks. The respondent's clock is the dangerous one.</li>
<li><strong>Is anyone under arrest?</strong> If yes this is an <strong>inquest</strong>, not a preliminary investigation, and the periods are in hours, not days. Escalate to a partner the same day.</li>
<li><strong>Prescription.</strong> Determine the prescriptive period for every offence charged before anything else. A prescribed offence is a dismissal we should be raising, or a complaint we should not be filing.</li>
<li><strong>Venue.</strong> Which prosecutor's office has territorial jurisdiction over where the offence was committed.</li>
<li><strong>Evidence inventory</strong> — original documents, their custodians, and whether we can produce originals if the authenticity is put in issue.</li>
<li><strong>Witnesses</strong>, and for each, whether they will actually execute an affidavit. A witness who will not sign is not a witness.</li>
<li><strong>Parallel proceedings</strong> — civil, administrative, labor, barangay. Facts admitted in one bind the client in the others.</li>
</ul>

<h2>Procedural spine</h2>
<table>
<thead><tr><th>Stage</th><th>Period</th><th>Notes</th></tr></thead>
<tbody>
<tr><td>Complaint-affidavit filed with the OCP/NPS</td><td>—</td><td>With supporting affidavits and evidence, subscribed as required</td></tr>
<tr><td>Prosecutor acts: dismiss, or issue subpoena</td><td>Short — verify</td><td>Subpoena comes with the complaint and supporting affidavits attached</td></tr>
<tr><td><strong>Counter-affidavit</strong></td><td><strong>10 days from receipt of subpoena</strong></td><td><strong>The critical deadline.</strong> Traditionally non-extendible as of right, and a motion to dismiss is not a substitute. Verify the current rule.</td></tr>
<tr><td>Reply / rejoinder</td><td>At the prosecutor's discretion</td><td>Not a matter of right — do not assume a second bite</td></tr>
<tr><td>Clarificatory hearing</td><td>If called</td><td>Attendance is not optional in practice</td></tr>
<tr><td>Resolution</td><td>Verify</td><td>Requires approval by the City/Provincial Prosecutor</td></tr>
<tr><td>Motion for reconsideration</td><td>15 days from receipt — verify</td><td></td></tr>
<tr><td>Petition for review to the DOJ</td><td>15 days — verify</td><td>Confirm the current appellate route and format</td></tr>
</tbody>
</table>

<h3>Two changes to confirm before you rely on the table</h3>
<ul>
<li><strong>The 2024 DOJ-NPS rules on preliminary investigation and inquest.</strong> The DOJ reissued its preliminary-investigation rules, and the reported change is significant: the standard for filing moved from probable cause toward <em>prima facie</em> evidence with a reasonable certainty of conviction, with knock-on changes to appeals. If accurate, this raises what a complainant must show and gives a respondent more to work with. <strong>Read the current circular before drafting either side.</strong></li>
<li><strong>Periods.</strong> Treat every period in the table above as requiring confirmation against the current rule, not the one you learned.</li>
</ul>

<h2>Deliverable chain in Lumilex</h2>
<p>Create these as External deliverables on the matter, with the external due date set to the real deadline:</p>
<ol>
<li>Complaint-Affidavit <em>or</em> Counter-Affidavit (subtype: Complaint / Other)</li>
<li>Supporting affidavits — one deliverable per affiant, subtype <strong>Judicial Affidavit</strong> where the form is Q&amp;A</li>
<li>Reply-Affidavit / Rejoinder-Affidavit, if invited</li>
<li>Position paper for a clarificatory hearing, if called</li>
<li>Motion for Reconsideration or Petition for Review, on an adverse resolution</li>
<li>Status Report to the client at each resolution</li>
</ol>

<h2>Failure modes</h2>
<ul>
<li><strong>Missing the counter-affidavit deadline.</strong> The single most damaging failure in this track. The case is resolved on the complainant's evidence alone.</li>
<li><strong>Affidavits that are argument rather than personal knowledge.</strong> A prosecutor discounts what an affiant could not have perceived. Run Affidavit Review.</li>
<li><strong>Annexes referred to but not attached</strong>, or attached without a witness to authenticate them.</li>
<li><strong>Admissions made in the counter-affidavit</strong> that are then binding in the parallel civil or labor case. Read the counter-affidavit as opposing counsel in the <em>other</em> case would.</li>
<li><strong>Prescription raised for the first time on review</strong>, when it was available at the outset.</li>
</ul>

<hr>

<h1>Track 2 — Labor (SEnA, NLRC, DOLE)</h1>
<p><em>28 active cases. Predominantly illegal dismissal and money claims.</em></p>

<h2>When this applies</h2>
<p>Employment disputes — dismissal, money claims, regularization, constructive dismissal. Note which side we act for: the burden allocation is asymmetric and it decides most of these cases.</p>

<h2>Intake checklist</h2>
<ul>
<li><strong>Employer or employee.</strong> In a dismissal case the <strong>employer carries the burden</strong> of proving the dismissal was for a just or authorized cause and that due process was observed. Acting for the employer, the case is won or lost in the documents that already exist on day one.</li>
<li><strong>The employment record</strong> — contract, payslips, 201 file, company rules, and every notice issued.</li>
<li><strong>The twin-notice trail.</strong> Notice to Explain, the employee's written explanation, the administrative hearing, and the Notice of Decision. Confirm the periods given were adequate. A defect here loses an otherwise valid dismissal.</li>
<li><strong>Money-claim computation</strong>, prepared early. The appeal bond is calculated off the award, and a surprise at appeal stage is a funding crisis.</li>
<li><strong>Prescription</strong> — illegal dismissal and money claims run on different periods. Verify both.</li>
</ul>

<h2>Procedural spine</h2>
<table>
<thead><tr><th>Stage</th><th>Period</th><th>Notes</th></tr></thead>
<tbody>
<tr><td><strong>SEnA</strong> — Request for Assistance</td><td>30-day mandatory conciliation-mediation</td><td>A condition precedent for most claims. Verify current coverage and exclusions.</td></tr>
<tr><td>Complaint filed with the NLRC</td><td>—</td><td>Regional Arbitration Branch with venue</td></tr>
<tr><td>Mandatory conciliation and mediation conferences</td><td>Limited settings</td><td>Settlement posture should be decided <em>before</em> the first setting, with client authority in hand</td></tr>
<tr><td><strong>Position paper</strong></td><td>As directed by the Labor Arbiter</td><td><strong>This is the case.</strong> Labor proceedings are largely decided on the position paper and its annexes — there is no trial in the ordinary sense</td></tr>
<tr><td>Reply</td><td>As directed</td><td></td></tr>
<tr><td>Labor Arbiter decision</td><td>Verify</td><td></td></tr>
<tr><td><strong>Appeal to the Commission</strong></td><td><strong>10 calendar days from receipt</strong> — verify</td><td>Calendar days, not working days. For a monetary award, an <strong>appeal bond</strong> in the amount of the award (exclusive of damages and attorney's fees) is jurisdictional — no bond, no appeal.</td></tr>
<tr><td>Motion for reconsideration of the NLRC decision</td><td>10 calendar days — verify</td><td>Generally only one is allowed, and it is a prerequisite to certiorari</td></tr>
<tr><td>Rule 65 certiorari to the Court of Appeals</td><td>60 days — verify</td><td>The route established in <em>St. Martin Funeral Home v. NLRC</em> — verify the citation against the official report</td></tr>
<tr><td>Rule 45 to the Supreme Court</td><td>15 days — verify</td><td></td></tr>
</tbody>
</table>

<h2>Deliverable chain in Lumilex</h2>
<ol>
<li>SEnA Request for Assistance / conference appearance</li>
<li>Position Paper — the anchor deliverable, with the full documentary record as annexes</li>
<li>Reply</li>
<li>Judicial Affidavits of company witnesses, where required</li>
<li>Memorandum of Appeal + appeal bond (create the bond as its own deliverable with its own deadline — it fails separately from the pleading)</li>
<li>Petition for Certiorari, on an adverse NLRC ruling</li>
<li>Status Report at each level</li>
</ol>

<h2>Failure modes</h2>
<ul>
<li><strong>The appeal bond.</strong> Filed late, filed short, or filed with a surety that is not accredited. Each is fatal, and each is avoidable with two weeks' notice to the client. Start the bond conversation when the decision is received, not when the appeal is drafted.</li>
<li><strong>Counting the 10-day appeal period in working days.</strong> It is calendar days.</li>
<li><strong>A position paper that argues the law and neglects the record.</strong> Attach the documents. An assertion in a position paper with no annex behind it is worth nothing.</li>
<li><strong>Procedural due process treated as an afterthought</strong> where the substantive cause is strong. A valid cause with a defective notice still costs the employer.</li>
<li><strong>Settlement authority obtained after the conference has started.</strong></li>
</ul>

<hr>

<h1>Track 3 — Regular civil actions (RTC / MeTC)</h1>
<p><em>Ordinary civil actions under the 2019 Amended Rules of Civil Procedure.</em></p>

<h2>When this applies</h2>
<p>Ordinary civil actions — collection, damages, specific performance, annulment, and the like. Special proceedings and special civil actions have their own rules and are outside this track.</p>

<h2>Intake checklist</h2>
<ul>
<li><strong>Jurisdiction and venue.</strong> Amount in controversy sets the court; verify the current jurisdictional thresholds, which have been adjusted.</li>
<li><strong>Prescription</strong> of the cause of action.</li>
<li><strong>Barangay conciliation</strong> — whether it is a condition precedent on these parties. Filing without it when required draws a dismissal.</li>
<li><strong>Certification against forum shopping</strong>, properly executed by the party (not counsel), with authority if the party is a corporation.</li>
<li><strong>The 2019 front-loading requirement.</strong> The amended rules require the parties to name their witnesses, summarize the intended testimony, and attach documentary and object evidence <strong>to the pleading itself</strong>. Evidence not front-loaded may be excluded. Verify the current text of the rule — this is the change that most often catches practitioners drafting from memory.</li>
</ul>

<h2>Procedural spine</h2>
<table>
<thead><tr><th>Stage</th><th>Period</th><th>Notes</th></tr></thead>
<tbody>
<tr><td>Complaint</td><td>—</td><td>With certification against forum shopping, witness list, testimony summaries, and evidence attached</td></tr>
<tr><td>Summons and service</td><td>—</td><td></td></tr>
<tr><td><strong>Answer</strong></td><td><strong>30 calendar days from service</strong> — verify</td><td>Extended from 15 by the 2019 amendments. Extensions are limited — verify how many and how long.</td></tr>
<tr><td>Compulsory counterclaims</td><td>With the answer</td><td>Not pleaded, generally barred</td></tr>
<tr><td>Reply</td><td>Only where permitted</td><td>The amended rules narrowed when a reply is allowed</td></tr>
<tr><td>Court-annexed mediation and JDR</td><td>As referred</td><td>Client attendance is generally required — calendar it with them early</td></tr>
<tr><td>Pre-trial brief</td><td>At least 3 calendar days before pre-trial — verify</td><td>Late or absent brief carries sanctions</td></tr>
<tr><td>Pre-trial</td><td>—</td><td>Non-appearance has consequences for both parties</td></tr>
<tr><td><strong>Judicial Affidavits</strong></td><td>Filed ahead of the hearing — verify the period</td><td>Serve as direct testimony under A.M. No. 12-8-8-SC. Late filing risks exclusion of the witness.</td></tr>
<tr><td>Trial</td><td>Under the continuous-trial guidelines</td><td>Settings are not readily reset — prepare witnesses to actually appear</td></tr>
<tr><td>Memorandum</td><td>As directed</td><td></td></tr>
<tr><td>Appeal</td><td>15 days from receipt — verify</td><td>Some cases require a record on appeal with a longer period</td></tr>
</tbody>
</table>

<h2>Deliverable chain in Lumilex</h2>
<ol>
<li>Demand Letter (where a demand is a prerequisite or simply good practice)</li>
<li>Complaint or Answer, with annexes</li>
<li>Pre-Trial Brief</li>
<li>Judicial Affidavit — one deliverable per witness, each through Affidavit Review</li>
<li>Motions as they arise (subtype: Motion)</li>
<li>Formal Offer of Evidence</li>
<li>Memorandum</li>
<li>Notice of Appeal / Appellant's Brief</li>
<li>Status Report after every hearing</li>
</ol>

<h2>Failure modes</h2>
<ul>
<li><strong>Evidence not front-loaded.</strong> The document you planned to spring at trial may never come in.</li>
<li><strong>A defective certification against forum shopping</strong> — signed by counsel, or by an officer without board authority.</li>
<li><strong>Barangay conciliation skipped</strong> where it was a condition precedent.</li>
<li><strong>Judicial Affidavits drafted as narrative prose</strong> rather than question-and-answer, or filed late.</li>
<li><strong>Pre-trial treated as a formality.</strong> Stipulations made there bind the client through trial.</li>
</ul>

<hr>

<h1>Client communication standard</h1>
<p>Applies across all three tracks.</p>
<ul>
<li><strong>Within 48 hours</strong> of any adverse order, resolution, or decision — a status report, with what it means and what we propose to do.</li>
<li><strong>Before every hearing</strong> the client attends — what will happen and what is expected of them.</li>
<li><strong>Monthly</strong> on every active case, even when nothing has moved. "Nothing has moved" is information; silence is not.</li>
<li><strong>Immediately</strong> when a deadline requires something only the client can supply — money for a bond, an original document, a signature, a witness.</li>
</ul>

<hr>

<h1>Maintaining this playbook</h1>
<p>When a rule changes, or when a case teaches us something a track should have told us, edit this page — do not circulate a correction by chat. Partners can edit. Note the date of any change to a period, and say what was verified against what.</p>
`.trim();

const EXCERPT =
  'How the firm runs a case, track by track — criminal preliminary investigation, labor, and regular civil actions. Intake checklists, procedural spines, deliverable chains, and the failure modes that lose these cases.';

runSeed('seed-playbook-litigation', {
  slug: 'playbook-litigation',
  title: 'Litigation Playbook',
  excerpt: EXCERPT,
  content: CONTENT,
  pinned: true,
});
