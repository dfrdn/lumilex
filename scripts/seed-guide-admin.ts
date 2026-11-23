/**
 * Seed script: the Admin User Guide, as a Library handbook page.
 *
 * Usage: npx tsx scripts/seed-guide-admin.ts <firmIdOrSlug> [--force]
 *
 * Takes the firm explicitly and writes through `getServiceDbForFirm`, which
 * stamps `firm_id` — `kb_pages.firm_id` is NOT NULL with no default, so the
 * unscoped raw client this used to build raised 23502. An existing row is left
 * alone unless `--force` is passed, so a re-run is a no-op.
 */

import { runSeed } from './resource-seed';

const FULL_CONTENT = `
<p><em>A comprehensive guide for administrative staff to manage workflows, databases, and firm operations through Lumilex Admin.</em></p>
<hr>

<h1>Getting Started</h1>

<h2>Logging In</h2>
<p>Navigate to the firm dashboard URL and select your name from the team member list. As an admin user, you will have access to the <strong>Admin Dashboard</strong> in addition to the standard dashboard.</p>

<h2>Admin Dashboard Overview</h2>
<p>After logging in, access the Admin Dashboard by clicking <strong>"Admin"</strong> in the sidebar or navigating to <strong>/admin</strong>. The admin overview page shows entity counts across all databases:</p>
<table>
<thead><tr><th>Entity</th><th>Description</th></tr></thead>
<tbody>
<tr><td><strong>Clients</strong></td><td>Total registered clients</td></tr>
<tr><td><strong>Matters</strong></td><td>Active and closed legal matters</td></tr>
<tr><td><strong>Deliverables</strong></td><td>Documents across all workflow stages</td></tr>
<tr><td><strong>Tasks</strong></td><td>Action items assigned to team members</td></tr>
<tr><td><strong>Meetings</strong></td><td>Scheduled and past meetings</td></tr>
<tr><td><strong>Hearings</strong></td><td>Court hearing records</td></tr>
<tr><td><strong>Filings</strong></td><td>Case filings and deadlines</td></tr>
<tr><td><strong>Files</strong></td><td>Uploaded documents and attachments</td></tr>
</tbody>
</table>

<blockquote><p><strong>Navigation:</strong> The admin sidebar is organized into four sections: <strong>Main</strong> (overview, calendar, chat), <strong>Workflows</strong> (prospects, parties, finalize, signatures, email), <strong>Databases</strong> (all entity CRUD), and <strong>Settings</strong> (integrations, templates, library, audit log). Search supports <strong>fuzzy matching</strong> — partial words and minor typos will still return results.</p></blockquote>

<hr>

<h1>Database Management</h1>
<p>As an admin, you have full <strong>Create, Read, Update, and Delete (CRUD)</strong> access to all firm databases. Each database page follows a consistent pattern.</p>

<h2>Working with Any Database</h2>
<ol>
<li>Navigate to the entity in the <strong>Databases</strong> section of the admin sidebar (e.g., Clients, Matters, Deliverables).</li>
<li>You will see a <strong>data table</strong> with sortable and filterable columns.</li>
<li>Use the <strong>search bar</strong> at the top to find specific records.</li>
<li>Click on any row to open the <strong>detail view</strong> for that record.</li>
</ol>

<h3>Creating Records</h3>
<ol>
<li>Click the <strong>"Add"</strong> or <strong>"New"</strong> button at the top of any database page.</li>
<li>Fill in the required fields in the form modal.</li>
<li>Click <strong>Save</strong> to create the record.</li>
</ol>

<h3>Editing Records</h3>
<ol>
<li>Click on a record to open its detail page.</li>
<li>Click the <strong>"Edit"</strong> button.</li>
<li>Modify the fields as needed.</li>
<li>Click <strong>Save</strong> to apply changes.</li>
</ol>

<h3>Deleting Records</h3>
<ol>
<li>Open the record's detail page.</li>
<li>Click the <strong>"Delete"</strong> button.</li>
<li>Confirm the deletion in the dialog.</li>
</ol>

<blockquote><p><strong>Caution:</strong> Deletions are permanent. Always verify you are deleting the correct record. If in doubt, consider marking a record as inactive instead of deleting it.</p></blockquote>

<hr>

<h2>Clients Database</h2>
<p>The <strong>Clients</strong> database stores all client information. Key fields include:</p>
<table>
<thead><tr><th>Field</th><th>Description</th></tr></thead>
<tbody>
<tr><td><strong>Client Code</strong></td><td>Unique identifier for the client</td></tr>
<tr><td><strong>Name</strong></td><td>Full legal name of the client</td></tr>
<tr><td><strong>Status</strong></td><td>Active, Inactive, or Prospective</td></tr>
<tr><td><strong>TIN</strong></td><td>Tax identification number</td></tr>
<tr><td><strong>Contact Info</strong></td><td>Address, phone, email</td></tr>
<tr><td><strong>Discount</strong></td><td>Billing discount percentage (if applicable)</td></tr>
<tr><td><strong>Receivables</strong></td><td>Outstanding balance</td></tr>
</tbody>
</table>

<h2>Matters Database</h2>
<p>The <strong>Matters</strong> database contains all legal cases and engagements. Each matter is linked to a client and includes:</p>
<ul>
<li><strong>Matter code</strong> — Unique case identifier</li>
<li><strong>Case title</strong> and <strong>case number</strong> (litigation)</li>
<li><strong>Court</strong> information</li>
<li><strong>Assigned lawyers</strong></li>
<li><strong>Case outcome</strong> and status</li>
</ul>

<h2>Deliverables Database</h2>
<p>Deliverables have additional configuration options:</p>
<ul>
<li><strong>Variable reviewers</strong> — Each deliverable supports <strong>1 to 5 reviewers</strong> in its review chain, each with their own target review dates</li>
<li><strong>Court record flag</strong> — Mark a deliverable as a court record (<strong>is_court_record</strong>) to indicate it is an official filing</li>
<li><strong>Version history</strong> — Track all submissions with a version-centric layout, reactions, and comment editing</li>
</ul>

<h2>Other Databases</h2>
<p>The same CRUD pattern applies to: <strong>Tasks</strong>, <strong>Meetings</strong>, <strong>Hearings</strong>, <strong>Filings</strong>, <strong>Files</strong>, and <strong>PH Holidays</strong>. Each has entity-specific fields but follows the same navigation and editing workflow.</p>

<hr>

<h1>Workflows</h1>

<h2>1. Prospect Management (Client Intake)</h2>
<p>The <strong>Prospects</strong> page provides a <strong>Kanban board</strong> for managing the client intake pipeline. Prospects move through the following stages:</p>

<table>
<thead><tr><th>Stage</th><th>Description</th><th>Actions</th></tr></thead>
<tbody>
<tr><td><strong>Lead</strong></td><td>Initial inquiry received</td><td>Log contact details, assign a lawyer</td></tr>
<tr><td><strong>Contacted</strong></td><td>First contact made</td><td>Schedule consultation</td></tr>
<tr><td><strong>Consultation</strong></td><td>Meeting scheduled or completed</td><td>Record consultation notes</td></tr>
<tr><td><strong>Proposal</strong></td><td>Fee proposal sent</td><td>Track proposed fee, engagement terms</td></tr>
<tr><td><strong>Engaged</strong></td><td>Client has formally retained the firm</td><td>Create client and matter records</td></tr>
</tbody>
</table>

<h3>Managing Prospects</h3>
<ol>
<li>Navigate to <strong>Workflows → Prospects</strong> in the admin sidebar.</li>
<li>The Kanban board shows cards organized by stage.</li>
<li>Drag cards between columns to update their stage.</li>
<li>Click on a prospect card to view or edit details.</li>
<li>Use the <strong>"Add Prospect"</strong> button to create new intake records.</li>
</ol>

<blockquote><p><strong>Important:</strong> When a prospect reaches "Engaged" status, create the corresponding client and matter records in the Databases section. This ensures the new engagement is properly set up for the lawyers.</p></blockquote>

<h2>2. Conflict of Interest — Parties</h2>
<p>The <strong>Parties</strong> page tracks all parties involved in each matter. This is essential for <strong>conflict of interest checking</strong>.</p>
<ul>
<li>Each party record includes: <strong>party name</strong>, <strong>role</strong> (plaintiff, defendant, etc.), <strong>entity type</strong>, <strong>aliases</strong>, and <strong>TIN</strong>.</li>
<li>Before accepting new clients, search the parties database to check for potential conflicts.</li>
<li>Parties are linked to specific matters for traceability.</li>
</ul>

<h3>Checking for Conflicts</h3>
<ol>
<li>Navigate to <strong>Workflows → Parties</strong>.</li>
<li>Use the search bar to search by party name, alias, or TIN.</li>
<li>Review matches to determine if any existing matter creates a conflict.</li>
<li>Document the conflict check result in the prospect record.</li>
</ol>

<h2>3. Document Finalization</h2>
<p>The <strong>Finalize</strong> page is where admin staff process deliverables that have been approved by reviewers and are ready for final output. The finalization workflow includes:</p>

<h3>Finalization Steps</h3>
<ol>
<li><strong>Accept Tracked Changes</strong> — Review the document for any remaining tracked changes and accept or reject them.</li>
<li><strong>Proofread</strong> — Perform a final proofread for formatting, grammar, and style consistency per the firm's Style Guide.</li>
<li><strong>Insert E-Signatures</strong> — Place authorized electronic signatures into the document at the designated signature blocks.</li>
<li><strong>Generate Final PDF</strong> — Convert the finalized document to PDF format for filing or sending.</li>
</ol>

<blockquote><p><strong>Workflow:</strong> Deliverables appear on the Finalize page when their status reaches "Pre-finalized." After processing, update the status to "Outbox" to indicate the document is ready for filing or delivery.</p></blockquote>

<h2>4. E-Signatures</h2>
<p>The <strong>Signatures</strong> page manages the firm's electronic signature assets. Admins can:</p>
<ul>
<li>View available signature images</li>
<li>Manage signature configurations for each partner</li>
<li>Ensure signature files are properly formatted and up to date</li>
</ul>
<h3>Client Engagement-Letter E-Signature</h3>
<p>Clients can <strong>electronically sign engagement letters</strong> from the Client Portal. The client reads the letter and types their full legal name to accept; the signature is recorded with their email, IP address, user agent, and timestamp, and is unique per matter and document. <strong>The team is notified</strong> when a client signs. This is distinct from the partner signature images above — it captures the <em>client's</em> acceptance, not the firm's signature.</p>

<h2>5. Email Management</h2>
<p>The <strong>Email</strong> section allows admins to manage email communications linked to matters. This includes:</p>
<ul>
<li>Viewing email threads associated with specific matters</li>
<li>Managing email templates for common communications</li>
<li>Linking incoming and outgoing emails to the correct matters</li>
</ul>

<h2>6. Public Intake Submissions</h2>
<p>The firm publishes a public intake form at <strong>/intake</strong> — separate forms for general inquiries, trademark matters, and incorporation. Submissions are quarantined and surface in a review queue at <strong>Prospects → Public Intake Submissions</strong> (available to admins and partners).</p>
<ol>
<li>Open the queue and review each inquiry's contact details, kind-specific fields, and message.</li>
<li>Click <strong>"Run conflict check"</strong> to screen the inquirer and any company/proposed names against existing parties and clients.</li>
<li><strong>Convert to prospect</strong> — creates the client record and a <strong>Lead</strong> in the prospects pipeline — or <strong>Dismiss</strong> the submission.</li>
</ol>
<blockquote><p><strong>Note:</strong> The intake form has spam protection (honeypot, per-IP throttle, per-email cap), so the queue stays clean. Still run a conflict check before converting anyone.</p></blockquote>

<h2>7. Email Proposals (Court-Mail Autopilot)</h2>
<p>The autopilot reviews every inbound email linked to a matter and proposes <strong>deadline chains</strong> (reglementary deadlines and hearings computed from a court document's trigger date) or <strong>file entries</strong> (recording an attachment in the matter's files). Proposals appear under <strong>Email Proposals</strong> in the admin sidebar's Workflows group.</p>
<p>Admins can <strong>preview</strong> the source document, <strong>revise</strong> the trigger date or file details, and <strong>Confirm</strong> or <strong>Dismiss</strong> each proposal. Confirming a deadline chain calendars the deadlines on the matter; confirming a file entry records the document in the matter's files. (Finance can view proposals but not confirm or dismiss them.)</p>

<h2>8. Pages distilled from our matters</h2>
<p>The <strong>Library</strong> (main dashboard → Tools → Library → <em>From our matters</em>) holds doctrine, template clauses, and judge/court/counsel profiles distilled from the firm's matters, every claim cited. Admins can edit drafts and <strong>Publish</strong> them (a page the system drafted cannot be published until every claim has a citation); the <strong>Needs review</strong> filter lists what is waiting. See the Partner guide for the full review workflow.</p>

<hr>

<h1>Calendar Management</h1>
<p>The admin <strong>Calendar</strong> provides a firm-wide view of all scheduled events. As an admin, you can:</p>
<ul>
<li>View all meetings, hearings, and deadlines across the firm</li>
<li>Create and modify calendar events</li>
<li>Manage PH holiday entries (under <strong>Databases → PH Holidays</strong>)</li>
<li>Click on any calendar entry to open a <strong>detail panel</strong> with full event information</li>
<li>Use <strong>clickable legend filters</strong> to show or hide specific event types</li>
</ul>

<hr>

<h1>Settings</h1>

<h2>Templates</h2>
<p>The <strong>Templates</strong> page manages document and email templates. Admins can:</p>
<ul>
<li>Create templates for common document types</li>
<li>Edit existing templates to update formatting or content</li>
<li>Organize templates by category</li>
</ul>

<h2>Library</h2>
<p>The <strong>Library</strong> holds the firm handbook (including this guide) alongside the pages distilled from our matters. Admins can:</p>
<ul>
<li>Write new handbook pages — guides, policies, references and announcements</li>
<li>Edit and update existing pages; every edit keeps the previous version</li>
<li>Pin important pages to the top of the list</li>
<li>Save as draft or publish immediately</li>
<li>Delete a handbook page</li>
</ul>

<h3>Writing a handbook page</h3>
<ol>
<li>Navigate to <strong>Settings → Library</strong>.</li>
<li>Click <strong>"New page"</strong>.</li>
<li>Enter the title, a short summary for the card, and the kind.</li>
<li>Use the <strong>rich text editor</strong> to write the content — you can add headings, bold/italic text, lists, tables, links, and more.</li>
<li>Click <strong>"Save draft"</strong> to save without publishing, or <strong>"Publish"</strong> to make it visible to all users.</li>
</ol>

<h2>Integrations</h2>
<p>The <strong>Integrations</strong> page (available to super users) manages connections to third-party services used by the firm.</p>

<h2>Audit Log</h2>
<p>The <strong>Audit Log</strong> (super user only) tracks all system activity, providing a trail of who made what changes and when.</p>

<hr>

<h1>User Management (Super Users Only)</h1>
<p>Super users can access <strong>System → User Management</strong> to:</p>
<ul>
<li>View all team members and their roles</li>
<li>Assign or change user roles (lawyer, admin, finance, partner, super_user)</li>
<li>Activate or deactivate user accounts</li>
<li>Update contact information</li>
</ul>

<hr>

<h1>Quick Reference — Daily Admin Workflow</h1>
<table>
<thead><tr><th>Time</th><th>Action</th><th>Where</th></tr></thead>
<tbody>
<tr><td><strong>Start of day</strong></td><td>Check admin overview for entity counts</td><td>Admin → Overview</td></tr>
<tr><td><strong>Start of day</strong></td><td>Review prospect pipeline for new leads</td><td>Workflows → Prospects</td></tr>
<tr><td><strong>Morning</strong></td><td>Process deliverables in finalization queue</td><td>Workflows → Finalize</td></tr>
<tr><td><strong>Morning</strong></td><td>Check calendar for today's events</td><td>Admin → Calendar</td></tr>
<tr><td><strong>Throughout day</strong></td><td>Respond to chat messages and data requests</td><td>Admin → Chat</td></tr>
<tr><td><strong>Throughout day</strong></td><td>Update database records as needed</td><td>Databases → [Entity]</td></tr>
<tr><td><strong>Start of day</strong></td><td>Review public intake submissions; run conflict checks</td><td>Prospects → Public Intake Submissions</td></tr>
<tr><td><strong>As needed</strong></td><td>Run conflict checks for new prospects</td><td>Workflows → Parties</td></tr>
<tr><td><strong>As needed</strong></td><td>Confirm court-mail deadline / file proposals</td><td>Workflows → Email Proposals</td></tr>
<tr><td><strong>As needed</strong></td><td>Manage email correspondence</td><td>Workflows → Email</td></tr>
</tbody>
</table>

<hr>

<h1>Sidebar Navigation Map</h1>

<table>
<thead><tr><th>Section</th><th>Pages</th></tr></thead>
<tbody>
<tr><td><strong>Main</strong></td><td>Overview, Calendar, Chat</td></tr>
<tr><td><strong>Workflows</strong></td><td>Prospects, Parties, Liaison Command, Finalize, Signatures, Email, Email Proposals</td></tr>
<tr><td><strong>Databases</strong></td><td>Clients, Matters, Deliverables, Tasks, Meetings, Hearings, Filings, Files, PH Holidays</td></tr>
<tr><td><strong>Settings</strong></td><td>Integrations, Templates, Library, Audit Log</td></tr>
<tr><td><strong>Tools (main dashboard)</strong></td><td>Search, Library, Drafting Studio, and Public Intake Submissions (under Prospects)</td></tr>
<tr><td><strong>System</strong></td><td>User Management (super user only)</td></tr>
</tbody>
</table>

<hr>
<p><em>For questions or issues, contact the system administrator or reach out on the firm chat. This guide is updated as new features are added to the system.</em></p>
`.trim();

runSeed('seed-guide-admin', {
  slug: 'user-guide-admin',
  title: 'User Guide — Admin',
  excerpt:
    'A complete guide for admin staff to manage workflows, databases, document finalization, prospect intake, and firm operations.',
  content: FULL_CONTENT,
  pinned: true,
});
