/**
 * The four billing-cycle email templates a new firm starts with, plus a neutral
 * general one.
 *
 * Source: `BILLING_TEMPLATE`, `REMINDER_TEMPLATE`, `OVERDUE_TEMPLATE` and
 * `FINAL_TEMPLATE` in components/finance/EmailTemplateEditor.tsx — the presets
 * the finance editor already offers, and already firm-neutral: they substitute
 * `{{firmName}}` where the archived pre-Lumilex seed hardcoded one firm's name
 * into the sign-off. Copied rather than imported because that module is a
 * `'use client'` React component; a provisioning script must not pull JSX and
 * lucide-react into a node process to read four strings.
 *
 * `category` is CHECK-constrained to the ten values in the union on
 * EmailTemplateSeed. `is_category_default` marks the one template per category
 * the batch-send flow reaches for; the app enforces "one per category" by
 * unsetting the others on save, not with a partial unique index, so the seed
 * must not mark two in the same category.
 *
 * `variables` is documentation: it is stored and round-tripped by the API, but
 * substitution reads the `{{tokens}}` out of the body itself
 * (`substituteVars` in the editor). Listing them keeps the editor's chip row
 * honest about what this template actually uses.
 */

import type { EmailTemplateSeed } from './types';

const SIGN_OFF = `<br/>
<p>Best regards,<br/><strong>{{firmName}}</strong><br/>Finance Department</p>`;

export const SEED_EMAIL_TEMPLATES: EmailTemplateSeed[] = [
  {
    name: 'Standard Billing',
    category: 'billing',
    is_category_default: true,
    subject: 'Billing Statement – {{month}} | {{clientName}}',
    body_html: `<p>Good day,</p>
<p>Please find attached our billing statement for <strong>{{month}}</strong> in the amount of <strong>{{amount}}</strong>.</p>
<p>Should you have any questions, please do not hesitate to contact us.</p>
${SIGN_OFF}`,
    variables: ['clientName', 'month', 'amount', 'firmName'],
  },
  {
    name: 'Gentle Reminder',
    category: 'reminder',
    is_category_default: true,
    subject: 'Reminder: Billing Statement – {{month}} | {{clientName}}',
    body_html: `<p>Good day,</p>
<p>This is a gentle reminder that your billing statement for <strong>{{month}}</strong> in the amount of <strong>{{amount}}</strong> is due on <strong>{{dueDate}}</strong>.</p>
<p>Kindly disregard this reminder if payment has already been made. Please find the original billing statement attached for your reference.</p>
${SIGN_OFF}`,
    variables: ['clientName', 'month', 'amount', 'dueDate', 'firmName'],
  },
  {
    name: 'Overdue Notice',
    category: 'overdue',
    is_category_default: true,
    subject: 'Overdue: Billing Statement – {{month}} | {{clientName}}',
    body_html: `<p>Good day,</p>
<p>Your billing statement for <strong>{{month}}</strong> amounting to <strong>{{amount}}</strong> is now <strong>{{daysOverdue}} days overdue</strong>.</p>
<p>We kindly request your prompt attention to this matter. Please find the billing statement attached for your reference.</p>
${SIGN_OFF}`,
    variables: ['clientName', 'month', 'amount', 'daysOverdue', 'firmName'],
  },
  {
    name: 'Final Notice',
    category: 'final',
    is_category_default: true,
    subject: 'Final Notice: Outstanding Balance – {{month}} | {{clientName}}',
    body_html: `<p>Good day,</p>
<p>This is a <strong>final notice</strong> regarding your outstanding balance of <strong>{{amount}}</strong> for the billing period of <strong>{{month}}</strong>, which is now <strong>{{daysOverdue}} days overdue</strong>.</p>
<p>We urge your immediate attention to this matter. Please find the billing statement attached.</p>
${SIGN_OFF}`,
    variables: ['clientName', 'month', 'amount', 'daysOverdue', 'firmName'],
  },
  // The compose modal's own vocabulary is snake_case and matter-shaped, not the
  // finance camelCase set above.
  {
    name: 'Matter Update',
    category: 'client_update',
    is_category_default: false,
    subject: '{{matter_name}} — Update',
    body_html: `<p>Good day,</p>
<p>We write to update you on <strong>{{matter_name}}</strong> ({{matter_code}}).</p>
<p></p>
<p>Please let us know if you have any questions.</p>
<br/>
<p>Best regards,<br/>{{sender_name}}</p>`,
    variables: ['matter_name', 'matter_code', 'sender_name'],
  },
];
