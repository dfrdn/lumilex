/**
 * Seed script: the Finance User Guide, as a Library handbook page.
 *
 * Usage: npx tsx scripts/seed-guide-finance.ts <firmIdOrSlug> [--force]
 *
 * Takes the firm explicitly and writes through `getServiceDbForFirm`, which
 * stamps `firm_id` — `kb_pages.firm_id` is NOT NULL with no default, so the
 * unscoped raw client this used to build raised 23502. An existing row is left
 * alone unless `--force` is passed, so a re-run is a no-op.
 */

import { runSeed } from './resource-seed';

const FULL_CONTENT = `
<p><em>A complete guide for the finance team to manage billing, invoicing, receivables, expenses, and profitability analysis through the Finance Dashboard.</em></p>
<hr>

<h1>Getting Started</h1>

<h2>Logging In</h2>
<p>Navigate to the firm dashboard URL and select your name from the team member list. As a finance user, you will have access to the <strong>Finance Dashboard</strong> — the central hub for all billing and financial operations.</p>

<h2>Finance Dashboard Overview</h2>
<p>After logging in, access the Finance Dashboard by clicking <strong>"Finance"</strong> in the sidebar or navigating to <strong>/finance</strong>. The overview page shows key financial metrics at a glance:</p>

<table>
<thead><tr><th>Metric</th><th>Description</th></tr></thead>
<tbody>
<tr><td><strong>Unbilled DTR Entries</strong></td><td>Number of time records not yet included in an invoice</td></tr>
<tr><td><strong>Monthly Billing Summary</strong></td><td>Total billed amount for the current month</td></tr>
<tr><td><strong>Outstanding Invoices</strong></td><td>Number of invoices with pending payments</td></tr>
<tr><td><strong>Total Outstanding AR</strong></td><td>Total accounts receivable balance across all clients</td></tr>
</tbody>
</table>

<blockquote><p><strong>Navigation:</strong> The finance sidebar is grouped into <strong>Main</strong> (Overview, Team Dashboard, My Tasks, Chat), <strong>Billing</strong> (Review &amp; Generate, Invoices, Receivables, Ledger), <strong>Analytics</strong> (Profitability, Cash Flow, Billing Insights), <strong>Expenses</strong> (Matter Expenses, Operating Expenses, Reimbursements), and <strong>Settings</strong> (Billing Configs, Templates, Rates, Transportation Tariff, Employees, Expense Categories, Firm Invoice Details).</p></blockquote>

<hr>

<h1>Billing Rates &amp; Configuration</h1>
<p>Before generating invoices, ensure billing rates and configurations are properly set up.</p>

<h2>1. Billing Rates</h2>
<p>The <strong>Rates</strong> page manages hourly billing rates. You can configure rates at multiple levels:</p>
<table>
<thead><tr><th>Level</th><th>Description</th><th>Priority</th></tr></thead>
<tbody>
<tr><td><strong>Lawyer Default</strong></td><td>Standard hourly rate for each lawyer</td><td>Lowest — used when no specific rate applies</td></tr>
<tr><td><strong>Client Rate</strong></td><td>Custom rate for a specific client</td><td>Overrides lawyer default</td></tr>
<tr><td><strong>Matter Rate</strong></td><td>Custom rate for a specific matter</td><td>Highest — overrides client and default rates</td></tr>
</tbody>
</table>

<h3>Setting Up Rates</h3>
<ol>
<li>Navigate to <strong>Rates</strong> in the finance sidebar.</li>
<li>View existing rate configurations in the table.</li>
<li>Click <strong>"Add Rate"</strong> to create a new rate entry.</li>
<li>Select the lawyer, client, or matter and enter the hourly rate.</li>
<li>Set the <strong>effective date</strong> — rates apply from this date forward.</li>
<li>Click <strong>Save</strong>.</li>
</ol>

<blockquote><p><strong>Tip:</strong> Review rates quarterly to ensure they align with engagement letters and client agreements. Rate changes only apply to new time entries — existing unbilled entries retain their original rate.</p></blockquote>

<h2>2. Billing Configurations</h2>
<p>The <strong>Billing Configs</strong> page allows you to set up client-specific billing rules:</p>
<ul>
<li><strong>Client-specific rates</strong> — Override default rates for special arrangements</li>
<li><strong>Matter billing rules</strong> — Custom rules for specific engagements</li>
<li><strong>Discount management</strong> — Configure automatic discounts for clients</li>
</ul>

<hr>

<h1>Invoice Generation</h1>
<p>The invoice generation workflow converts unbilled DTR (Daily Time Record) entries into formal invoices.</p>

<h2>Step-by-Step Invoice Generation</h2>
<ol>
<li>Navigate to <strong>Generate</strong> in the finance sidebar.</li>
<li><strong>Select the billing period</strong> — Choose the month and year for the invoice.</li>
<li><strong>Select clients</strong> — Choose one or more clients to generate invoices for. The system shows the number of unbilled DTR entries for each client.</li>
<li><strong>Review entries</strong> — The system displays all unbilled time entries for the selected period and clients, with:
  <ul>
  <li>Lawyer name</li>
  <li>Date of work</li>
  <li>Matter and task description</li>
  <li>Hours worked</li>
  <li>Applicable billing rate</li>
  <li>Line total</li>
  </ul>
</li>
<li><strong>Adjust if needed</strong> — Review and modify any entries before generating.</li>
<li><strong>Generate invoice</strong> — Click <strong>"Generate"</strong> to create the invoice. The system will:
  <ul>
  <li>Calculate total amounts using configured billing rates</li>
  <li>Apply any client discounts</li>
  <li>Create the invoice record</li>
  <li>Mark the included DTR entries as "billed"</li>
  </ul>
</li>
</ol>

<blockquote><p><strong>Important:</strong> Always review the DTR entries before generating. Once an invoice is created, the included time entries are marked as billed and will not appear in future invoice generation runs.</p></blockquote>

<hr>

<h1>Invoice Management</h1>
<p>The <strong>Invoices</strong> page provides a complete view of all generated invoices and their statuses.</p>

<h2>Invoice Status Workflow</h2>
<table>
<thead><tr><th>Status</th><th>Description</th><th>Actions</th></tr></thead>
<tbody>
<tr><td><strong>Draft</strong></td><td>Invoice generated but not yet sent</td><td>Review, edit, or delete</td></tr>
<tr><td><strong>Sent</strong></td><td>Invoice delivered to the client</td><td>Track payment, send reminders</td></tr>
<tr><td><strong>Paid</strong></td><td>Full payment received</td><td>Record payment details</td></tr>
<tr><td><strong>Partially Paid</strong></td><td>Partial payment received</td><td>Record amount, follow up on balance</td></tr>
<tr><td><strong>Overdue</strong></td><td>Payment past due date</td><td>Send payment reminder, escalate</td></tr>
</tbody>
</table>

<h3>Managing Invoices</h3>
<ol>
<li>Navigate to <strong>Invoices</strong> in the finance sidebar.</li>
<li>View all invoices in the data table — sortable by date, client, amount, and status.</li>
<li>Click on an invoice to view its full details, including:
  <ul>
  <li>Line items (DTR entries included)</li>
  <li>Total amount and expenses</li>
  <li>Payment history</li>
  <li>Client information</li>
  </ul>
</li>
<li>Use the status filter to quickly find draft, sent, or overdue invoices.</li>
</ol>

<h3>Recording Payments</h3>
<ol>
<li>Open the invoice that received payment.</li>
<li>Click <strong>"Record Payment"</strong>.</li>
<li>Enter the <strong>payment amount</strong> and <strong>date received</strong>.</li>
<li>The system will automatically update the invoice status to "Paid" (full amount) or "Partially Paid" (partial amount).</li>
</ol>

<h3>Sending Invoices</h3>
<ol>
<li>Open a draft invoice.</li>
<li>Review the details for accuracy.</li>
<li>Click <strong>"Send"</strong> to deliver the invoice to the client via email.</li>
<li>The system uses the configured email template and updates the status to "Sent."</li>
</ol>

<h2>Client Portal Billing (Self-Service)</h2>
<p>Clients with portal access can view their own billing at <strong>/portal/billing</strong>. They see their <strong>outstanding balance</strong>, total <strong>billed to date</strong>, <strong>deposits on hand</strong>, every <strong>issued invoice</strong> with its payment history, and a <strong>download link</strong> for each invoice letter (PDF).</p>
<blockquote><p><strong>Important:</strong> Only <strong>sent</strong> invoices are visible to clients — <strong>drafts are structurally hidden</strong>. An invoice (and any correction) becomes client-visible the moment you mark it Sent, so finalize before sending. Recorded payments appear in the client's history automatically.</p></blockquote>
<p>The <strong>Receivables</strong> page provides a comprehensive view of all outstanding client balances.</p>

<h2>Aging Analysis</h2>
<p>The receivables page includes an aging report that categorizes outstanding balances by how long they have been unpaid:</p>
<table>
<thead><tr><th>Aging Bucket</th><th>Description</th></tr></thead>
<tbody>
<tr><td><strong>Current</strong></td><td>Invoices within payment terms</td></tr>
<tr><td><strong>30 Days</strong></td><td>1–30 days past due</td></tr>
<tr><td><strong>60 Days</strong></td><td>31–60 days past due</td></tr>
<tr><td><strong>90+ Days</strong></td><td>More than 90 days past due — requires immediate attention</td></tr>
</tbody>
</table>

<h3>Using the Receivables Dashboard</h3>
<ol>
<li>Navigate to <strong>Receivables</strong> in the finance sidebar.</li>
<li>View outstanding balances by client.</li>
<li>Sort by aging bucket to prioritize collection efforts.</li>
<li>Click on a client to see their individual invoice history and payment terms.</li>
</ol>

<blockquote><p><strong>Best Practice:</strong> Review the 90+ days bucket weekly. These accounts may require escalation to a partner for follow-up. Send payment reminders proactively for invoices approaching 30 days past due.</p></blockquote>

<hr>

<h1>Profitability Analysis</h1>
<p>The <strong>Profitability</strong> page provides financial performance insights across multiple dimensions.</p>

<h2>Available Reports</h2>
<table>
<thead><tr><th>Report</th><th>Description</th></tr></thead>
<tbody>
<tr><td><strong>Revenue by Matter</strong></td><td>Total billed revenue per legal matter</td></tr>
<tr><td><strong>Revenue by Lawyer</strong></td><td>Billed hours and revenue generated per lawyer</td></tr>
<tr><td><strong>Revenue by Client</strong></td><td>Total revenue from each client</td></tr>
<tr><td><strong>Utilization Rates</strong></td><td>Percentage of available hours that were billed</td></tr>
<tr><td><strong>Profit Margins</strong></td><td>Revenue minus allocated costs</td></tr>
<tr><td><strong>Cost Analysis</strong></td><td>Expense breakdown by category</td></tr>
</tbody>
</table>

<h3>Using Profitability Reports</h3>
<ol>
<li>Navigate to <strong>Profitability</strong> in the finance sidebar.</li>
<li>Select the reporting period (month, quarter, or custom range).</li>
<li>View charts and data tables for each dimension.</li>
<li>Use filters to drill down into specific clients, matters, or lawyers.</li>
</ol>

<blockquote><p><strong>Insight:</strong> Low utilization rates may indicate capacity for new work, while high utilization with low revenue could signal rate adjustment needs. Use these reports in quarterly partner reviews.</p></blockquote>

<hr>

<h1>Billing Insights</h1>
<p>The <strong>Billing Insights</strong> page (finance sidebar → <strong>Billing Insights</strong>, under Analytics) goes beyond headline revenue to show where billable value leaks, how clients actually pay, and what each billing model earns. The page opens with four topline cards (written off, average days to pay, open A/R, expected 30-day collections) followed by four detail sections.</p>

<h2>1. Write-offs &amp; Discounts (Leakage)</h2>
<p>Per client over the trailing window: the hours finance <strong>excluded, reduced, or marked non-billable</strong> during DTR review — valued at position rates — plus the <strong>leak rate</strong> (share of reviewed hours lost) and the average discount applied on invoices. This is the billable value that never made it onto a bill.</p>

<h2>2. Client Payment Behavior</h2>
<p>Lifetime, per client: amounts <strong>billed</strong>, <strong>collected</strong>, and <strong>outstanding</strong>; the count of paid vs. open invoices; and the <strong>average days to pay</strong> (payment-amount weighted, measured from the invoice send date). Slow payers are flagged in amber (over 30 days) and red (over 60 days).</p>

<h2>3. Billing-Model Economics</h2>
<p>For each matter billing type (hourly, fixed fee, retainer, and so on): billed revenue, hours worked, the <strong>effective hourly rate</strong>, and margin — showing which billing arrangements actually pay off.</p>

<h2>4. Collections Forecast</h2>
<p>Open invoices are aged into buckets and run against the firm's <strong>own historical payment curve</strong> to estimate expected collections within 30, 60, and 90 days. Invoices older than any recorded payment have no signal in the curve and are flagged to chase directly.</p>

<blockquote><p><strong>Note:</strong> The forecast is built from the firm's recorded payments — treat it as directional until enough payment history accumulates. Hours for any lawyer without a matching team position rate are valued at ₱0 and flagged in the leakage table.</p></blockquote>

<hr>

<h1>Expense Management</h1>

<h2>1. Firm Expenses</h2>
<p>The <strong>Expenses</strong> page tracks all firm-related expenses. Each expense record includes:</p>
<ul>
<li><strong>Description</strong> — What the expense is for</li>
<li><strong>Amount</strong> — Cost in PHP</li>
<li><strong>Category</strong> — Transportation, filing fees, supplies, etc.</li>
<li><strong>Matter/Client allocation</strong> — Which case the expense is tied to (for pass-through billing)</li>
<li><strong>Receipt</strong> — Uploaded proof of expense</li>
</ul>

<h3>Managing Expenses</h3>
<ol>
<li>Navigate to <strong>Expenses</strong> in the finance sidebar.</li>
<li>View all expense records in the data table.</li>
<li>Filter by category, date range, or matter.</li>
<li>Click on an expense to view details and attached receipt.</li>
</ol>

<h2>2. Reimbursements</h2>
<p>The <strong>Reimbursements</strong> page manages expense reimbursement requests from team members.</p>

<h3>Reimbursement Workflow</h3>
<table>
<thead><tr><th>Status</th><th>Description</th><th>Finance Action</th></tr></thead>
<tbody>
<tr><td><strong>Pending</strong></td><td>Lawyer submitted request</td><td>Review expense and receipt</td></tr>
<tr><td><strong>Approved</strong></td><td>Expense verified as valid</td><td>Approve and schedule payment</td></tr>
<tr><td><strong>Reimbursed</strong></td><td>Payment processed</td><td>Record payment confirmation</td></tr>
<tr><td><strong>Rejected</strong></td><td>Expense not eligible</td><td>Provide reason for rejection</td></tr>
</tbody>
</table>

<h3>Processing Reimbursements</h3>
<ol>
<li>Navigate to <strong>Reimbursements</strong> in the finance sidebar.</li>
<li>Filter by <strong>"Pending"</strong> status to see new requests.</li>
<li>Open each request to review:
  <ul>
  <li>Expense description and amount</li>
  <li>Category and linked matter</li>
  <li>Uploaded receipt image</li>
  <li>Requesting team member</li>
  </ul>
</li>
<li>Click <strong>"Approve"</strong> or <strong>"Reject"</strong>.</li>
<li>Once payment is processed, update the status to <strong>"Reimbursed"</strong>.</li>
</ol>

<blockquote><p><strong>Reminder:</strong> Reimbursements should be filed within 5 business days of the expense per firm policy. Flag any late submissions and coordinate with the admin team.</p></blockquote>

<hr>

<h1>Email Templates</h1>
<p>The <strong>Templates</strong> page manages email templates used for financial communications. Common templates include:</p>
<ul>
<li><strong>Invoice email</strong> — Standard message when sending invoices to clients</li>
<li><strong>Payment reminder</strong> — Follow-up for overdue invoices</li>
<li><strong>Payment acknowledgment</strong> — Confirmation when payment is received</li>
<li><strong>Statement of account</strong> — Summary of client's outstanding balance</li>
</ul>

<h3>Managing Templates</h3>
<ol>
<li>Navigate to <strong>Templates</strong> in the finance sidebar.</li>
<li>View existing templates in the list.</li>
<li>Click on a template to edit its content.</li>
<li>Use placeholders (e.g., client name, invoice number, amount) that will be auto-filled when sending.</li>
<li>Create new templates with the <strong>"New Template"</strong> button.</li>
</ol>

<hr>

<h1>Quick Reference — Monthly Billing Cycle</h1>
<table>
<thead><tr><th>When</th><th>Action</th><th>Where</th></tr></thead>
<tbody>
<tr><td><strong>1st–3rd of month</strong></td><td>Review previous month's unbilled DTR entries</td><td>Finance → Review &amp; Generate</td></tr>
<tr><td><strong>3rd–5th of month</strong></td><td>Generate invoices for all clients</td><td>Finance → Review &amp; Generate</td></tr>
<tr><td><strong>5th–7th of month</strong></td><td>Review and finalize draft invoices</td><td>Finance → Invoices</td></tr>
<tr><td><strong>7th–10th of month</strong></td><td>Send invoices to clients</td><td>Finance → Invoices</td></tr>
<tr><td><strong>15th of month</strong></td><td>Send payment reminders for overdue invoices</td><td>Finance → Receivables</td></tr>
<tr><td><strong>Weekly</strong></td><td>Process pending reimbursement requests</td><td>Finance → Reimbursements</td></tr>
<tr><td><strong>Weekly</strong></td><td>Review receivables aging report</td><td>Finance → Receivables</td></tr>
<tr><td><strong>Monthly</strong></td><td>Run profitability reports for partner review</td><td>Finance → Profitability</td></tr>
<tr><td><strong>Monthly</strong></td><td>Review leakage, payment behavior, and collections forecast</td><td>Finance → Billing Insights</td></tr>
<tr><td><strong>Quarterly</strong></td><td>Review and update billing rates</td><td>Finance → Rates</td></tr>
</tbody>
</table>

<hr>

<h1>Sidebar Navigation Map</h1>
<table>
<thead><tr><th>Page</th><th>Purpose</th></tr></thead>
<tbody>
<tr><td><strong>Overview</strong></td><td>Financial KPI dashboard with key metrics</td></tr>
<tr><td><strong>Team Dashboard</strong></td><td>Finance team activity and workload view</td></tr>
<tr><td><strong>My Tasks</strong></td><td>Your assigned finance tasks</td></tr>
<tr><td><strong>Review &amp; Generate</strong></td><td>Review DTR entries and generate invoices from them</td></tr>
<tr><td><strong>Invoices</strong></td><td>View, edit, send, and track all invoices</td></tr>
<tr><td><strong>Receivables</strong></td><td>Accounts receivable aging and collection tracking</td></tr>
<tr><td><strong>Ledger</strong></td><td>Per-client running-balance ledger and statements</td></tr>
<tr><td><strong>Profitability</strong></td><td>Revenue, utilization, and profit analysis</td></tr>
<tr><td><strong>Cash Flow</strong></td><td>Cash-flow analytics (billed vs. collected)</td></tr>
<tr><td><strong>Billing Insights</strong></td><td>Leakage, payment behavior, billing-model economics, collections forecast</td></tr>
<tr><td><strong>Matter Expenses</strong></td><td>Matter-billable expense tracking and allocation</td></tr>
<tr><td><strong>Operating Expenses</strong></td><td>Firm operating costs (not billed to clients)</td></tr>
<tr><td><strong>Reimbursements</strong></td><td>Team member expense reimbursement processing</td></tr>
<tr><td><strong>Billing Configs</strong></td><td>Client-specific billing rules and discounts</td></tr>
<tr><td><strong>Templates</strong></td><td>Email templates for invoices and reminders</td></tr>
<tr><td><strong>Rates</strong></td><td>Hourly billing rate management</td></tr>
<tr><td><strong>Transportation Tariff</strong></td><td>Liaison transportation rate table</td></tr>
<tr><td><strong>Employees</strong></td><td>Team member compensation and position rates</td></tr>
<tr><td><strong>Expense Categories</strong></td><td>Manage expense category options</td></tr>
<tr><td><strong>Firm Invoice Details</strong></td><td>Firm bank details and invoice letter settings</td></tr>
</tbody>
</table>

<hr>
<p><em>For questions or issues, contact the system administrator or reach out on the firm chat. This guide is updated as new features are added to the system.</em></p>
`.trim();

runSeed('seed-guide-finance', {
  slug: 'user-guide-finance',
  title: 'User Guide — Finance',
  excerpt:
    'A complete guide for the finance team to manage billing, invoicing, receivables, expenses, reimbursements, and profitability analysis.',
  content: FULL_CONTENT,
  pinned: true,
});
