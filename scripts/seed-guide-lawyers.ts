/**
 * Seed script: the Lawyers User Guide, as a Library handbook page.
 *
 * Usage: npx tsx scripts/seed-guide-lawyers.ts <firmIdOrSlug> [--force]
 *
 * Takes the firm explicitly and writes through `getServiceDbForFirm`, which
 * stamps `firm_id` — `kb_pages.firm_id` is NOT NULL with no default, so the
 * unscoped raw client this used to build raised 23502. An existing row is left
 * alone unless `--force` is passed, so a re-run is a no-op.
 */

import { runSeed } from './resource-seed';

const FULL_CONTENT = `
<p><em>A step-by-step guide for associates and staff lawyers to navigate Lumilex — your central hub for matters, deliverables, time tracking, and collaboration.</em></p>
<hr>

<h1>Getting Started</h1>

<h2>Logging In</h2>
<p>Navigate to the firm dashboard URL and select your name from the team member list. You will be authenticated and directed to your personal dashboard.</p>
<blockquote><p><strong>Tip:</strong> Bookmark the dashboard URL for quick daily access. Your session persists across browser tabs.</p></blockquote>

<h2>Dashboard Overview</h2>
<p>Your main dashboard is the first screen you see after logging in. It provides a snapshot of everything you need for the day, organized into the following sections:</p>

<table>
<thead><tr><th>Section</th><th>What It Shows</th></tr></thead>
<tbody>
<tr><td><strong>Today</strong></td><td>Tasks, meetings, hearings, and filings due today</td></tr>
<tr><td><strong>My Week</strong></td><td>Calendar view of your upcoming schedule for the week</td></tr>
<tr><td><strong>Recent Files</strong></td><td>Files recently shared with you or uploaded to your matters</td></tr>
<tr><td><strong>Deliverables</strong></td><td>Active deliverables in "My Queue" and "Team" tabs, with board and table views</td></tr>
<tr><td><strong>Emails</strong></td><td>Recent email correspondence linked to your matters</td></tr>
<tr><td><strong>Backlogs</strong></td><td>Overdue or at-risk items that need immediate attention</td></tr>
<tr><td><strong>Weekly Calendar</strong></td><td>Weekly schedule with matter names, clickable entries, and legend filters</td></tr>
</tbody>
</table>

<blockquote><p><strong>Navigation:</strong> Use the sidebar on the left to access all pages. On mobile, tap the menu icon at the top-left to open the sidebar. You can also use the search bar (or press <strong>Ctrl+K</strong> / <strong>Cmd+K</strong>) to quickly jump to any page, matter, or client. Search supports <strong>fuzzy matching</strong>, so partial words and minor typos will still return results.</p></blockquote>

<h2>Quick-Create Button</h2>
<p>A <strong>floating action button (+)</strong> is available at the bottom-right corner of most pages. Tap it to quickly create:</p>
<ul>
<li><strong>Task</strong> — Assign yourself or a colleague an action item</li>
<li><strong>Meeting</strong> — Schedule a new meeting with attendees</li>
<li><strong>Hearing</strong> — Add a court hearing to the calendar</li>
<li><strong>Deliverable</strong> — Create a new work product entry</li>
</ul>
<blockquote><p><strong>Tip:</strong> Use the quick-create button to log items on the go without navigating away from your current page. You can also add a DTR entry directly from the FAB.</p></blockquote>

<hr>

<h1>Core Features</h1>

<h2>1. Attendance — Clock In / Clock Out</h2>
<p>At the top of your dashboard, you will find the attendance tracker. This records your daily work hours.</p>
<ol>
<li>Click <strong>"Clock In"</strong> when you begin your workday.</li>
<li>The timer will display your elapsed work time throughout the day.</li>
<li>Click <strong>"Clock Out"</strong> at the end of your workday.</li>
</ol>
<blockquote><p><strong>Note:</strong> Your clock-in and clock-out times are visible to partners for attendance monitoring. If you forget to clock out, contact the admin to adjust your record.</p></blockquote>

<h2>2. Matters</h2>
<p>The <strong>Matters</strong> page displays all legal cases and engagements you are assigned to. Each matter card shows:</p>
<ul>
<li><strong>Matter code</strong> and title</li>
<li><strong>Client name</strong></li>
<li><strong>Case type</strong> — Litigation or Non-Litigation</li>
<li><strong>Court</strong> and case number (for litigation matters)</li>
<li><strong>Assigned team</strong> — the lawyers working on this matter</li>
</ul>

<h3>My Matters</h3>
<p>The <strong>My Matters</strong> page provides a personalized view of all matters assigned to you, with additional tools for tracking and prioritization:</p>
<ul>
<li><strong>Urgency tracking</strong> — Each matter shows an urgency indicator to help you prioritize your caseload</li>
<li><strong>Notes</strong> — Add personal notes to any matter for quick context</li>
<li><strong>Entity columns</strong> — See counts of deliverables, tasks, hearings, and filings at a glance for each matter</li>
</ul>

<h3>Viewing Matter Details</h3>
<p>Click on any matter to open its detail page, which includes:</p>
<ul>
<li><strong>Overview tab</strong> — Key case information, parties, team members, and timeline</li>
<li><strong>Deliverables</strong> — All documents linked to this matter</li>
<li><strong>Tasks</strong> — Action items for this matter</li>
<li><strong>Meetings</strong> — Scheduled meetings and past notes</li>
<li><strong>Hearings</strong> — Court hearing schedule and outcomes</li>
<li><strong>Filings</strong> — Filing deadlines and statuses</li>
<li><strong>Files</strong> — Uploaded documents and attachments</li>
<li><strong>Emails</strong> — Email correspondence linked to this matter</li>
</ul>

<blockquote><p><strong>Quick Access:</strong> From any matter detail page, you can click the deliverable, task, or meeting items to jump directly to their detail views.</p></blockquote>

<h2>3. Deliverables</h2>
<p>Deliverables are the core work product of the firm. The <strong>Deliverables</strong> page shows all documents assigned to you with their current status.</p>

<h3>Deliverable Workflow</h3>
<p>Every deliverable follows a structured pipeline:</p>
<table>
<thead><tr><th>Stage</th><th>Description</th><th>Your Role</th></tr></thead>
<tbody>
<tr><td><strong>Not Started</strong></td><td>Deliverable created but work not begun</td><td>Begin drafting when assigned</td></tr>
<tr><td><strong>Drafting</strong></td><td>Active writing in progress</td><td>Draft the document</td></tr>
<tr><td><strong>Under Review</strong></td><td>Submitted for initial review</td><td>Wait for reviewer feedback</td></tr>
<tr><td><strong>Revising</strong></td><td>Incorporating reviewer comments</td><td>Address feedback and revise</td></tr>
<tr><td><strong>Finalizing</strong></td><td>Final review in progress</td><td>Await final approval</td></tr>
<tr><td><strong>Pre-finalized</strong></td><td>Approved, pending admin processing</td><td>No action needed</td></tr>
<tr><td><strong>Outbox</strong></td><td>Ready for filing or sending</td><td>Coordinate with liaison</td></tr>
<tr><td><strong>Filed / Sent Out</strong></td><td>Completed and delivered</td><td>Done</td></tr>
</tbody>
</table>

<h3>Working with Deliverables</h3>
<ol>
<li>Navigate to <strong>Deliverables</strong> in the sidebar, or view them under a specific matter.</li>
<li>Click on a deliverable to see its full details, including version history and action log.</li>
<li>Use the <strong>"By Status"</strong> view to see all your deliverables grouped by pipeline stage.</li>
</ol>

<h3>Version History</h3>
<p>Each deliverable maintains a <strong>version history</strong> that tracks all submissions and revisions. The version history view shows:</p>
<ul>
<li><strong>Version-centric layout</strong> — Each version is displayed as a card showing the files submitted, reviewer comments, and timestamps</li>
<li><strong>Reactions</strong> — React to versions with emojis to provide quick feedback</li>
<li><strong>Comments</strong> — Add and edit comments on specific versions</li>
<li><strong>Multi-file versions</strong> — Each version can contain multiple files</li>
</ul>

<h3>Reviewers</h3>
<p>Deliverables support <strong>up to 5 reviewers</strong>, each with their own review dates. The review chain ensures thorough quality control before finalization.</p>

<blockquote><p><strong>Tip:</strong> Check your <strong>Deliverables</strong> page daily — use the <strong>"My Queue"</strong> tab to see deliverables currently assigned to you, and switch to <strong>"Team"</strong> to see your team's workload. Both views support a <strong>board view</strong> (grouped by status) and a <strong>table view</strong>.</p></blockquote>

<h2>4. Tasks</h2>
<p>The <strong>Tasks</strong> page displays discrete action items assigned to you. Each task includes:</p>
<ul>
<li><strong>Title</strong> and description</li>
<li><strong>Linked matter</strong></li>
<li><strong>Due date</strong> and priority level</li>
<li><strong>Status</strong> — Not started, In progress, Done</li>
</ul>
<p>Tasks appear on your dashboard under "Today" when their due date matches the current day.</p>

<h2>5. Meetings</h2>
<p>The <strong>Meetings</strong> page shows all scheduled meetings — client meetings, internal discussions, and conferences. Each meeting shows:</p>
<ul>
<li>Date, time, and location</li>
<li>Meeting type</li>
<li>Linked matter and attendees</li>
<li>Meeting notes and action items</li>
</ul>
<p>Upcoming meetings also appear on your <strong>My Week</strong> calendar view and the <strong>Firm Calendar</strong>.</p>

<h2>6. Hearings</h2>
<p>The <strong>Hearings</strong> page tracks all court appearances. Each hearing record includes:</p>
<ul>
<li><strong>Date and time</strong></li>
<li><strong>Court</strong> and branch</li>
<li><strong>Hearing type</strong> — Initial, Pre-Trial, Trial, Promulgation, Motion Hearing</li>
<li><strong>Status</strong> — Scheduled, Attended, Cancelled, Postponed</li>
<li><strong>Attendees</strong></li>
</ul>
<blockquote><p><strong>Reminder:</strong> Always update the hearing status after your court appearance. Include the court's orders, next hearing date, and any action items in the notes.</p></blockquote>

<h2>7. Filings</h2>
<p>The <strong>Filings</strong> page tracks all filing deadlines for court submissions. Each filing links to a specific deliverable and matter, showing:</p>
<ul>
<li>Filing date and deadline</li>
<li>Related deliverable and matter</li>
<li>Filing status</li>
</ul>

<h2>8. My Requests</h2>
<p>The <strong>My Requests</strong> page (accessible from the sidebar) tracks all your personal submissions to the firm. It has three tabs:</p>
<table>
<thead><tr><th>Tab</th><th>What It Shows</th></tr></thead>
<tbody>
<tr><td><strong>Leaves</strong></td><td>Your filed leave requests (vacation, sick, emergency, personal) and their approval status</td></tr>
<tr><td><strong>Reimbursements</strong></td><td>Expense reimbursement requests you have filed, with totals and status</td></tr>
<tr><td><strong>Feedbacks</strong></td><td>Feedback you have submitted and any responses received</td></tr>
</tbody>
</table>

<h3>Filing a Leave Request</h3>
<ol>
<li>Click the <strong>"File Leave"</strong> button on your dashboard, or go to My Requests.</li>
<li>Select the leave type, start and end dates, and reason.</li>
<li>Submit the request — it will be sent for approval.</li>
</ol>

<h3>Filing a Reimbursement</h3>
<ol>
<li>Click the <strong>"File Reimbursement"</strong> button on your dashboard, or go to My Requests.</li>
<li>Enter the expense details, amount, category, and attach your receipt.</li>
<li>Submit for processing by the finance team.</li>
</ol>

<h2>9. Document Generator</h2>
<p>The <strong>Document Generator</strong> page creates documents from firm <em>templates</em> with placeholder substitution. For an AI-drafted document grounded in a matter's facts and the firm's prior work, use the <strong>Drafting Studio</strong> (below) instead.</p>

<hr>

<h1>AI-Assisted Tools</h1>
<p>Lumilex includes a set of AI tools that draw on the firm's own work rather than generic boilerplate. They live under the <strong>Tools</strong> group in the sidebar.</p>

<h2>Drafting Studio</h2>
<p>The <strong>Drafting Studio</strong> (sidebar → <strong>Drafting Studio</strong>) produces a first draft of a legal document grounded in the firm's own materials — never from a blank page.</p>
<ol>
<li>Pick the <strong>matter</strong>.</li>
<li>Type <strong>what you want to draft</strong> (e.g. "Motion for Reconsideration"), or tap one of the common-document chips.</li>
<li>Optionally add <strong>instructions</strong> — the relief sought, arguments to emphasize, tone.</li>
<li>As you fill these in, the <strong>"Grounded on"</strong> panel on the right previews what the draft will draw on: the <strong>matter brief</strong>, matching <strong>firm knowledge</strong> pages, and <strong>our prior filings</strong> on similar work.</li>
<li>Click <strong>"Generate draft"</strong>. The result is a <strong>.docx in the firm's house style</strong> that you can download.</li>
</ol>
<p>By default the draft is also <strong>added to the matter as a draft deliverable</strong> (you choose External, Internal, or For Client) and can be <strong>routed to reviewers</strong> you select — so it enters the normal review pipeline immediately. Uncheck that option if you only want the file.</p>
<blockquote><p><strong>Important:</strong> This is an <strong>AI first draft</strong> — always review and revise before filing. If a draft hits the length limit it may be cut off before the prayer or signature block; review the tail and regenerate if needed.</p></blockquote>

<h2>Pages distilled from our matters</h2>
<p>The <strong>Library</strong> (sidebar → <strong>Library</strong> → <em>From our matters</em>) holds the firm's institutional memory, distilled from our own matters: <strong>doctrine</strong>, reusable <strong>template clauses</strong>, and profiles of <strong>judges, courts, opposing counsel, and opposing parties</strong>. Every claim on a page is <strong>cited</strong> to the matters it came from.</p>
<ul>
<li><strong>Browse and filter</strong> by kind (Doctrine, Template Clause, Judge, Court, and so on) and by status. Each page lists the matters it was distilled from alongside a citations sidebar.</li>
<li><strong>Published vs. Draft</strong> — pages marked <strong>"Draft — needs review"</strong> are AI-drafted and awaiting partner review; <strong>Published</strong> pages have been approved. Treat drafts as provisional.</li>
<li>Publishing these pages is a partner/admin action; everyone on the team can read.</li>
</ul>
<p>For a free-text question across the firm's knowledge, use <strong>Search</strong> (sidebar → <strong>Search</strong>) — a semantic search over the same material.</p>
<p>When the court-mail autopilot detects a deadline in an inbound email, an admin confirms it and the resulting deadlines are calendared on the matter — they surface on your <strong>Weekly Calendar</strong> and <strong>Backlogs</strong> like any other.</p>

<hr>

<h1>Daily Time Records (DTR)</h1>

<h2>Why DTR Matters</h2>
<p>Your Daily Time Records are the foundation of the firm's billing system. Accurate time tracking ensures clients are billed correctly and the firm can analyze profitability and utilization.</p>

<h2>Logging Your Hours</h2>
<ol>
<li>Navigate to <strong>My DTR</strong> in the sidebar.</li>
<li>Click <strong>"Add Entry"</strong> to create a new time record.</li>
<li>Fill in the required fields:
  <ul>
  <li><strong>Date</strong> — The day the work was performed</li>
  <li><strong>Client</strong> — Select the client from the dropdown</li>
  <li><strong>Matter</strong> — Select the specific matter</li>
  <li><strong>Task description</strong> — Brief description of work done</li>
  <li><strong>Hours and minutes</strong> — Time spent</li>
  </ul>
</li>
<li>Click <strong>Save</strong> to record the entry.</li>
</ol>

<h3>Monthly Summary</h3>
<p>The DTR page includes a <strong>monthly summary</strong> section with charts showing:</p>
<ul>
<li>Total hours logged this month</li>
<li>Hours breakdown by matter/client</li>
<li>Hours breakdown by task type</li>
<li>Daily distribution of work</li>
</ul>

<blockquote><p><strong>Best Practice:</strong> Log your time at the end of each day while the work is still fresh. Backfilling at the end of the week often leads to inaccurate entries.</p></blockquote>

<hr>

<h1>Collaboration Tools</h1>

<h2>Chat</h2>
<p>The built-in <strong>Chat</strong> system allows internal messaging with your colleagues. Access it from the sidebar or the header icon.</p>
<ul>
<li>Messages are organized by <strong>channels</strong> — direct messages and group channels</li>
<li>You can react to messages with emojis</li>
<li><strong>@mentions</strong> — Type <strong>@</strong> followed by a colleague's name to mention them directly. They will receive a notification for the mention</li>
<li><strong>Read receipts</strong> — See who has read your messages</li>
<li>Use chat to discuss matters, coordinate on deliverables, or share quick updates</li>
</ul>

<h2>Files</h2>
<p>The <strong>Files</strong> page serves as the firm's document repository. You can:</p>
<ul>
<li>Browse files by matter</li>
<li>View file details including origin, dates, and action taken</li>
<li>Access file URLs to download or view documents</li>
</ul>

<h2>Email</h2>
<p>The <strong>Emails</strong> section (accessible from the sidebar or within a matter) shows email correspondence linked to specific matters. This provides a complete communication trail for each case.</p>

<h2>Notifications</h2>
<p>The <strong>bell icon</strong> in the header shows your notifications. You will receive alerts for:</p>
<ul>
<li>New task assignments</li>
<li>Deliverable status changes</li>
<li>Upcoming meeting reminders</li>
<li>Hearing schedule updates</li>
<li>Firm announcements</li>
</ul>

<h2>Client Portal — What Your Clients See</h2>
<p>Clients granted access have a separate <strong>Client Portal</strong> (outside this dashboard). It's useful to know what they can do, since it affects how you communicate:</p>
<ul>
<li><strong>Matter view</strong> — the client-facing summary, the schedule, filed deliverables, and visible files for each of their matters.</li>
<li><strong>Ask about your case</strong> — a per-matter AI assistant scoped to <strong>client-safe</strong> information only (summary, schedule, filed documents, their own requests). It has no access to internal memos, strategy, or billing detail.</li>
<li><strong>Billing</strong> — their statement of account, payment history, deposits on hand, and downloadable copies of issued invoices.</li>
<li><strong>E-signature</strong> — clients electronically sign engagement letters from the portal. <strong>The team is notified</strong> when a client signs.</li>
</ul>

<hr>

<h1>Calendar</h1>
<p>The dashboard includes two calendar views:</p>

<h2>Weekly Calendar</h2>
<p>The <strong>Weekly Calendar</strong> (accessible from the sidebar) shows your schedule for the current week with:</p>
<ul>
<li><strong>Meetings, hearings, and deadlines</strong> displayed on the day they occur</li>
<li><strong>Matter names</strong> shown on each calendar entry for quick context</li>
<li><strong>Detail view toggle</strong> — Click on any calendar entry to open a detail panel with full information</li>
<li><strong>Clickable legend filters</strong> — Click on the legend labels (Meetings, Hearings, Filings, etc.) to show or hide specific event types</li>
</ul>

<h2>Firm Calendar</h2>
<p>The <strong>Firm Calendar</strong> provides a comprehensive firm-wide view of all events, including:</p>
<ul>
<li><strong>Your meetings</strong> — highlighted in your calendar</li>
<li><strong>Hearings</strong> — court appearances with details</li>
<li><strong>Deadlines</strong> — filing due dates and deliverable deadlines</li>
<li><strong>Firm events</strong> — holidays, firm meetings, and announcements</li>
</ul>
<p>Use the calendars to plan your week and ensure you never miss a critical date.</p>

<hr>

<h1>Library</h1>
<p>The <strong>Library</strong>'s <em>Firm handbook</em> holds firm guides, policies, and reference materials. Key pages include:</p>
<ul>
<li><strong>Firm Protocols</strong> — Firm policies, daily workflow, and onboarding checklist</li>
<li><strong>Style Guide</strong> — Writing standards, formatting rules, and citation guide</li>
<li><strong>User Guides</strong> — This guide and other system tutorials</li>
</ul>
<p>Handbook pages are Guides, Policies, References, or Announcements. Use the search bar and kind filters to find what you need.</p>
<p>Lawyers can write handbook pages too: click <strong>New page</strong>, write in the rich-text editor, and save a draft or publish. Every edit keeps the previous version, and only partners and admins can delete a page.</p>
<blockquote><p><strong>Handbook vs. pages from our matters:</strong> the <em>Firm handbook</em> holds firm policies, style guides, and tutorials like this one, written by people. <em>From our matters</em> is different — legal doctrine and template clauses distilled from our own matters, with every claim cited.</p></blockquote>

<hr>

<h1>Quick Reference — Daily Workflow</h1>
<table>
<thead><tr><th>Time</th><th>Action</th><th>Where</th></tr></thead>
<tbody>
<tr><td><strong>Start of day</strong></td><td>Clock in</td><td>Dashboard header</td></tr>
<tr><td><strong>Start of day</strong></td><td>Check today's tasks, meetings, hearings</td><td>Dashboard → Today</td></tr>
<tr><td><strong>Morning</strong></td><td>Review deliverable assignments</td><td>Deliverables → My Queue</td></tr>
<tr><td><strong>Throughout day</strong></td><td>Update deliverable statuses as you work</td><td>Deliverables</td></tr>
<tr><td><strong>Throughout day</strong></td><td>Check notifications and chat messages</td><td>Header bell icon / Chat</td></tr>
<tr><td><strong>After hearings</strong></td><td>Update hearing status and notes</td><td>Hearings</td></tr>
<tr><td><strong>End of day</strong></td><td>Log all time entries</td><td>My DTR (or use the + button)</td></tr>
<tr><td><strong>End of day</strong></td><td>Clock out</td><td>Dashboard header</td></tr>
</tbody>
</table>

<hr>

<h1>Keyboard Shortcuts</h1>
<table>
<thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
<tbody>
<tr><td><strong>Ctrl+K</strong> / <strong>Cmd+K</strong></td><td>Open search — quickly jump to any matter, client, deliverable, task, or other entity. Supports fuzzy matching for typo tolerance</td></tr>
</tbody>
</table>

<hr>
<p><em>For questions or issues, contact the office administrator or reach out on the firm chat. This guide is updated as new features are added to the system.</em></p>
`.trim();

runSeed('seed-guide-lawyers', {
  slug: 'user-guide-lawyers',
  title: 'User Guide — Lawyers',
  excerpt:
    'A complete guide for associates and staff lawyers to navigate Lumilex: matters, deliverables, DTR, calendar, chat, and more.',
  content: FULL_CONTENT,
  pinned: true,
});
