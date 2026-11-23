import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import TemplateManager from '@/components/admin/TemplateManager';

export const metadata: Metadata = { title: 'Templates' };

export default async function TemplatesPage() {
  await requireRouteAccess('/admin/templates');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Template Management</h1>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">Create and manage document templates for AI generation and placeholders</p>
      </div>
      <TemplateManager />
    </div>
  );
}
