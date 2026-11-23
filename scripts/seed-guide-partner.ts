/**
 * Seed script: the Partner User Guide, as a Library handbook page.
 *
 * Usage: npx tsx scripts/seed-guide-partner.ts <firmIdOrSlug> [--force]
 *
 * Takes the firm explicitly and writes through `getServiceDbForFirm`, which
 * stamps `firm_id` — `kb_pages.firm_id` is NOT NULL with no default, so the
 * unscoped raw client this used to build raised 23502. An existing row is left
 * alone unless `--force` is passed, so a re-run is a no-op.
 */

import { runSeed } from './resource-seed';

const FULL_CONTENT = `
<p><em>A guide for partners and monitoring partners to manage team oversight, deliverable reviews, workload assignments, and firm operations through Lumilex.</em></p>
<hr>

<h1>Getting Started</h1>

<h2>Partner Dashboard</h2>
<p>As a partner, you have access to everything in <strong>Lumilex</strong> plus a set of management pages in the sidebar for firm oversight. These partner-only pages appear at the top of your sidebar navigation.</p>

<blockquote><p><strong>Note:</strong> All standard lawyer features (matters, deliverables, tasks, DTR, chat, etc.) are documented in the <strong>User Guide — Lawyers</strong>. This guide covers the additional partner pages and workflows.</p></blockquote>

<hr>

<h1>Partner Pages</h1>

<h2>1. Partner Overview</h2>
<p>The <strong>Partner Overview</strong> page provides a high-level dashboard with firm-wide metrics and activity summaries to help you monitor operations at a glance.</p>

<h2>2. Leave Requests</h2>
<p>The <strong>Leave Requests</strong> page displays all leave requests filed by team members. You can:</p>
<ul>
<li><strong>Filter by status</strong> — View all requests, or filter by Pending, Approved, or Rejected</li>
<li><strong>Review details</strong> — See the lawyer's name, leave type (vacation, sick, emergency, personal), dates, and reason</li>
<li><strong>Approve or reject</strong> — Click the approve or reject button on any pending request. The status updates immediately</li>
</ul>
<blockquote><p><strong>Tip:</strong> Check the Leave Requests page at the start of each day for any pending requests that need your attention.</p></blockquote>

<h2>3. Pre-Finalizing Review</h2>
<p>The <strong>Pre-Finalizing</strong> page shows deliverables that are in "Finalizing" or "Pre-finalized" status, ready for your final review before admin processing.</p>
<ol>
<li>Review each deliverable's content, version history, and reviewer comments.</li>
<li>Confirm the deliverable is ready for finalization.</li>
<li>The admin team will then process the document (accept tracked changes, insert e-signatures, generate PDF).</li>
</ol>

<h2>4. Feedbacks</h2>
<p>The <strong>Feedbacks</strong> page displays all feedback submissions from team members. Review feedback to stay informed about team concerns, suggestions, and observations.</p>

<h2>5. Court Rules</h2>
<p>The <strong>Court Rules</strong> page provides automated deadline calculations based on Philippine court rules. Available rule sets include:</p>
<table>
<thead><tr><th>Category</th><th>Rule Sets</th></tr></thead>
<tbody>
<tr><td><strong>Litigation</strong></td><td>Service of Summons (Regular &amp; Summary), Adverse Judgment, Motion for Reconsideration, Petition for Certiorari</td></tr>
<tr><td><strong>Labor (NLRC)</strong></td><td>Receipt of Summons, LA Decision, NLRC Resolution</td></tr>
<tr><td><strong>Tax (CTA)</strong></td><td>Final Assessment Notice, Adverse CIR Decision, CTA Petition</td></tr>
</tbody>
</table>
<p>Each rule set calculates cascading deadlines based on a trigger event (e.g., date of service) and can auto-create filing entries and hearing records for the matter.</p>

<h2>6. Prospects</h2>
<p>The <strong>Prospects</strong> page provides a <strong>Kanban board</strong> for managing the client intake pipeline. Prospects move through stages: Lead → Contacted → Consultation → Proposal → Engaged.</p>
<ul>
<li>Drag cards between columns to update their stage</li>
<li>Click on a prospect card to view or edit details</li>
<li>When a prospect reaches "Engaged," coordinate with admin to create the client and matter records</li>
</ul>

<h2>7. Workload</h2>
<p>The <strong>Workload</strong> page provides a comprehensive view of team capacity and assignments. It has three tabs:</p>

<h3>Summary Tab</h3>
<p>A grid of lawyer cards showing at a glance:</p>
<ul>
<li>Total matters count and matter type breakdown (Litigation, Retainer, Labor, Tax, etc.)</li>
<li>Pending deliverables count</li>
<li>Hours worked this month</li>
</ul>

<h3>Team Assignment Tab</h3>
<p>Manage lawyer-to-matter assignments in two modes:</p>
<ul>
<li><strong>By Matter</strong> — Search for a matter and assign/unassign lawyers</li>
<li><strong>By Lawyer</strong> — Select a lawyer and manage their assigned matters</li>
</ul>

<h3>Lawyer Detail Tab</h3>
<p>Select any team member to view their individual profile:</p>
<ul>
<li><strong>Weekly calendar</strong> — Color-coded view of their meetings, hearings, filings, deadlines, reviews, leaves, and holidays</li>
<li><strong>Matter list</strong> — All matters assigned to the lawyer with type breakdown</li>
<li><strong>DTR analytics</strong> — Monthly time records showing hours spent on tasks by matter</li>
</ul>
<p>Use the <strong>lawyer switcher dropdown</strong> to navigate between team members without leaving the detail view.</p>

<h2>8. The Library</h2>
<p>The <strong>Library</strong> (under the <strong>Tools</strong> group) holds the firm handbook and, under <em>From our matters</em>, the firm's institutional memory — doctrine, template clauses, and profiles of judges, courts, and opposing counsel/parties — distilled from our own matters, with every claim cited.</p>
<h3>Building and Reviewing Pages</h3>
<ul>
<li><strong>Build from matters</strong> — distills new and updated pages from the matter archive. The system drafts pages and marks them <strong>"Draft — needs review."</strong> The <strong>Needs review</strong> filter lists everything waiting.</li>
<li><strong>Review and edit</strong> — open a draft, read it against its citations sidebar, and edit the content if needed. Editing marks a page <strong>manually curated</strong>, so future backfills won't overwrite it.</li>
<li><strong>Publish</strong> — once satisfied, publish the page to the firm. A page with <strong>no citations cannot be published</strong> — every claim must be grounded in a source. You can also unpublish a page back to draft.</li>
</ul>
<p>Published pages feed the <strong>Drafting Studio</strong> and the firm's <strong>Search</strong>, so partner review is the quality gate that keeps the Library trustworthy. Lawyers write and publish handbook pages themselves; every edit keeps the previous version, and deleting a handbook page stays with partners and admins.</p>

<h2>9. Public Intake Submissions</h2>
<p>The firm has a public intake form at <strong>/intake</strong> (general, trademark, and incorporation inquiries). Submissions land in a review queue at <strong>Prospects → Public Intake Submissions</strong>.</p>
<ol>
<li>Review each inquiry's details and message.</li>
<li>Click <strong>"Run conflict check"</strong> to screen the inquirer (and any company or proposed names) against existing parties and clients.</li>
<li><strong>Convert to prospect</strong> — creates the client and a <strong>Lead</strong> in the prospects pipeline — or <strong>Dismiss</strong> the submission.</li>
</ol>
<blockquote><p><strong>Tip:</strong> Always run the conflict check before converting. A clean result clears the inquiry; potential conflicts are listed with severity so you can decline or escalate.</p></blockquote>

<hr>

<h1>Deliverable Review Workflow</h1>
<p>As a partner, you will frequently serve as a reviewer in the deliverable pipeline. Key points:</p>
<ul>
<li>Deliverables support <strong>up to 5 reviewers</strong> in the review chain, each with their own target review dates</li>
<li>Use the <strong>version history</strong> to track all submissions — each version shows the files submitted, comments, and reactions</li>
<li>Add <strong>reactions</strong> to versions for quick feedback, or use <strong>comments</strong> for detailed review notes</li>
<li>When satisfied, advance the deliverable status to the next pipeline stage</li>
</ul>

<hr>

<h1>Quick Reference — Partner Daily Workflow</h1>
<table>
<thead><tr><th>Time</th><th>Action</th><th>Where</th></tr></thead>
<tbody>
<tr><td><strong>Start of day</strong></td><td>Check Partner Overview for firm metrics</td><td>Partner Overview</td></tr>
<tr><td><strong>Start of day</strong></td><td>Review and action pending leave requests</td><td>Leave Requests</td></tr>
<tr><td><strong>Morning</strong></td><td>Review deliverables in your review queue</td><td>Deliverables → My Queue</td></tr>
<tr><td><strong>Morning</strong></td><td>Check pre-finalizing queue</td><td>Pre-Finalizing</td></tr>
<tr><td><strong>Throughout day</strong></td><td>Monitor team workload and assignments</td><td>Workload</td></tr>
<tr><td><strong>As needed</strong></td><td>Review new feedback submissions</td><td>Feedbacks</td></tr>
<tr><td><strong>As needed</strong></td><td>Check prospect pipeline for new leads</td><td>Prospects</td></tr>
<tr><td><strong>As needed</strong></td><td>Screen and convert public intake inquiries</td><td>Public Intake Submissions</td></tr>
<tr><td><strong>As needed</strong></td><td>Calculate court deadlines for new matters</td><td>Court Rules</td></tr>
<tr><td><strong>Weekly</strong></td><td>Review and publish new Library drafts</td><td>Library → Needs review</td></tr>
</tbody>
</table>

<hr>

<h1>Sidebar Navigation — Partner Pages</h1>
<table>
<thead><tr><th>Page</th><th>Purpose</th></tr></thead>
<tbody>
<tr><td><strong>Partner Overview</strong></td><td>High-level firm dashboard with KPIs</td></tr>
<tr><td><strong>Leave Requests</strong></td><td>Review and approve/reject team leave requests</td></tr>
<tr><td><strong>Pre-Finalizing</strong></td><td>Final review of deliverables before admin processing</td></tr>
<tr><td><strong>Feedbacks</strong></td><td>Review team feedback submissions</td></tr>
<tr><td><strong>Court Rules</strong></td><td>Automated court deadline calculations</td></tr>
<tr><td><strong>Prospects</strong></td><td>Client intake pipeline (Kanban board)</td></tr>
<tr><td><strong>Public Intake Submissions</strong></td><td>Review public inquiries, run conflict checks, convert to prospects</td></tr>
<tr><td><strong>Workload</strong></td><td>Team capacity, assignments, and individual lawyer details</td></tr>
<tr><td><strong>Library</strong></td><td>Review, edit, and publish AI-distilled doctrine and clause pages; the firm handbook (Tools group)</td></tr>
</tbody>
</table>

<hr>
<p><em>For questions or issues, reach out on the firm chat. This guide is updated as new features are added to the system.</em></p>
`.trim();

runSeed('seed-guide-partner', {
  slug: 'user-guide-partner',
  title: 'User Guide — Partners',
  excerpt:
    'A guide for partners to manage leave requests, deliverable reviews, workload assignments, court rules, prospects, and team oversight.',
  content: FULL_CONTENT,
  pinned: true,
  visible_to_roles: ['partner', 'super_user'],
});
