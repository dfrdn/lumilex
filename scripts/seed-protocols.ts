/**
 * Seed script: the firm Protocols resource.
 *
 * Usage: npx tsx scripts/seed-protocols.ts <firmIdOrSlug> [--force]
 *
 * Takes the firm explicitly and writes through `getServiceDbForFirm`, which
 * stamps `firm_id` — `kb_pages.firm_id` is NOT NULL with no default, so the
 * unscoped raw client this used to build raised 23502. An existing row is left
 * alone unless `--force` is passed, so a re-run is a no-op.
 */

import { runSeed } from './resource-seed';

const FULL_CONTENT = `
<h1>Productivity Tools</h1>
<ul>
<li>We primarily use <strong>Notion</strong> and <strong>Notion Calendar</strong> to monitor all our to-dos.</li>
<li>For email, we use <strong>Outlook</strong>.</li>
<li>We use <strong>Anycase.ai</strong> as our primary legal research tool.</li>
</ul>

<h2>Firm Database Structure</h2>
<p>The firm's work is organized into six core entities in our database:</p>
<ol>
<li><strong>Clients</strong> — Each client record contains contact details, engagement status, client code, and point persons. Clients may have multiple matters.</li>
<li><strong>Matters</strong> — A matter represents a specific legal engagement under a client. Matters may be litigation (with case title, case number, and court) or non-litigation (transactional, advisory). Each matter is assigned a team of lawyers.</li>
<li><strong>Deliverables</strong> — All work product produced by the firm. Deliverables are linked to a matter and go through a workflow: <em>Not started → Drafting → Under Review → Revising → Finalizing → Pre-finalized → Outbox → Filed or Sent out</em>. Each deliverable has a drafter and may have an initial and final reviewer.</li>
<li><strong>Meetings</strong> — Internal discussions, client meetings, court hearings, and conferences. Each meeting is linked to a matter and has attendees.</li>
<li><strong>Hearings &amp; Filings</strong> — Court hearings and filing deadlines. Hearings have a type (Initial Hearing, Pre-Trial, Trial, Promulgation, Motion Hearing) and status (Scheduled, Attended, Cancelled, Postponed). Filings are deliverables with an external due date tied to a case matter.</li>
<li><strong>Tasks</strong> — Discrete action items assigned to team members with due dates and priority levels.</li>
</ol>

<h2>Daily Workflow</h2>
<ol>
<li><strong>Start of day</strong> — Check Notion Calendar and the firm dashboard for today's deadlines, hearings, and tasks.</li>
<li><strong>Throughout the day</strong> — Update deliverable statuses as you progress. Move items through the pipeline promptly.</li>
<li><strong>End of day</strong> — Ensure all work done that day is reflected in Notion. Update meeting notes and hearing outcomes.</li>
</ol>

<hr>

<h1>Company Policies</h1>

<h2>Onboarding Checklist</h2>
<p>New team members must complete the following upon joining:</p>
<ul>
<li>Firm email address (Outlook) set up</li>
<li>Anycase.ai account created</li>
<li>Added to firm group chat</li>
<li>Laptop issued and configured</li>
<li>Notion workspace access granted</li>
<li>Introduction to firm database structure</li>
<li>Review of the firm's Style Guide</li>
<li>Review of these Protocols</li>
</ul>

<h2>Leaves</h2>
<ul>
<li><strong>Filing a leave</strong> — All leave requests must be filed through the firm's leave system at least <strong>3 business days</strong> in advance for planned leaves, or as soon as practicable for emergency leaves.</li>
<li><strong>Leave types</strong> — Vacation Leave, Sick Leave, Emergency Leave, and other types as applicable.</li>
<li><strong>Approval</strong> — Leaves require approval from a partner. The system tracks approval status.</li>
<li><strong>Acting partner</strong> — When filing a leave, designate an acting partner or senior associate who will cover your active matters.</li>
<li><strong>Handover</strong> — Before going on leave, ensure all urgent deliverables are reassigned or completed, and brief your acting partner on pending items.</li>
</ul>

<h2>Reimbursements</h2>
<ul>
<li><strong>Eligible expenses</strong> — Transportation for client meetings and court appearances, filing fees, notarial fees, and other firm-related expenses.</li>
<li><strong>Filing</strong> — Submit reimbursement requests through the firm system with receipts attached. Include the related matter for proper billing allocation.</li>
<li><strong>Timeline</strong> — Reimbursements should be filed within <strong>5 business days</strong> of the expense.</li>
</ul>

<h2>Pantry</h2>
<ul>
<li>The firm pantry is a shared resource. Please clean up after yourself and dispose of waste properly.</li>
<li>Report any supplies that need restocking to the office administrator.</li>
</ul>

<h2>Laptop</h2>
<ul>
<li>Firm-issued laptops are for professional use. Keep your device updated and secure.</li>
<li>Do not install unauthorized software. Contact the administrator for any software needs.</li>
<li>Back up your work regularly. Critical files should be stored in the firm's shared systems, not solely on your local machine.</li>
</ul>

<h2>Work-from-Home</h2>
<ul>
<li>WFH arrangements must be coordinated with your supervising partner in advance.</li>
<li>You must be reachable during regular work hours via email and the firm group chat.</li>
<li>Ensure you have a stable internet connection and a quiet working environment.</li>
<li>All deliverables and deadlines remain the same regardless of work location.</li>
</ul>

<h2>Attire</h2>
<ul>
<li><strong>Office days</strong> — Business casual. Collared shirts, slacks, or smart casual attire.</li>
<li><strong>Court appearances</strong> — Formal business attire. Male lawyers: coat and tie. Female lawyers: blazer or formal dress.</li>
<li><strong>Client meetings</strong> — Business formal or business casual, depending on the nature of the meeting.</li>
</ul>

<h2>Work Schedule</h2>
<ul>
<li><strong>Regular hours</strong> — Monday to Friday, 9:00 AM to 6:00 PM.</li>
<li><strong>Flexibility</strong> — Reasonable flexibility is allowed with prior coordination, but core hours (10:00 AM to 4:00 PM) should be observed.</li>
<li><strong>Overtime</strong> — Extended hours may be necessary during heavy filing periods or trial preparation. Coordinate with your team to manage workload.</li>
</ul>

<h2>Firm Meeting</h2>
<ul>
<li><strong>Weekly firm meeting</strong> — Held every week to discuss ongoing matters, upcoming deadlines, and firm updates.</li>
<li><strong>Attendance</strong> — All lawyers are expected to attend unless on approved leave.</li>
<li><strong>Preparation</strong> — Review your active matters and be prepared to provide updates on deliverable status, upcoming hearings, and any issues requiring partner guidance.</li>
</ul>

<hr>

<h1>Output Logistics</h1>

<h2>Liaison</h2>
<ul>
<li><strong>Filing with courts and agencies</strong> — Coordinate with the firm liaison for physical filing of documents. Submit finalized documents to the liaison at least <strong>one business day</strong> before the filing deadline.</li>
<li><strong>Service of pleadings</strong> — Ensure proper service on all parties in accordance with the Rules of Court. Document proof of service.</li>
<li><strong>Tracking</strong> — Update the filing status in Notion once the liaison confirms successful filing.</li>
</ul>

<h2>Hearings</h2>
<ul>
<li><strong>Preparation</strong> — Review all relevant pleadings and evidence at least <strong>2 days</strong> before the hearing. Prepare a hearing brief or outline if necessary.</li>
<li><strong>Court appearance</strong> — Arrive at least <strong>30 minutes</strong> before the scheduled hearing time. Bring all necessary documents including proof of filing, IDs, and IBP receipts.</li>
<li><strong>Post-hearing</strong> — Update the hearing status in Notion immediately after. File hearing notes including the court's orders, next hearing date, and any action items.</li>
<li><strong>Resetting</strong> — If a hearing is postponed or cancelled, update the status and coordinate with the team on the new schedule.</li>
</ul>
`.trim();

runSeed('seed-protocols', {
  slug: 'protocols',
  title: 'Firm Protocols',
  excerpt:
    'Firm policies, tooling, the daily workflow, the deliverable pipeline, and the onboarding checklist.',
  content: FULL_CONTENT,
  pinned: true,
});
