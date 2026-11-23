import { useState, useEffect, useCallback } from 'react';
import {
  BILLING_TEMPLATE, REMINDER_TEMPLATE, OVERDUE_TEMPLATE, FINAL_TEMPLATE,
  type EmailTemplate,
} from '@/components/finance/EmailTemplateEditor';

export interface SavedTemplate {
  id: number;
  name: string;
  category: string;
  subject: string;
  body_html: string;
  is_category_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const FALLBACKS: Record<string, EmailTemplate> = {
  billing: BILLING_TEMPLATE,
  reminder: REMINDER_TEMPLATE,
  overdue: OVERDUE_TEMPLATE,
  final: FINAL_TEMPLATE,
};

export function toEmailTemplate(t: SavedTemplate): EmailTemplate {
  return { subject: t.subject, body: t.body_html };
}

export function useEmailTemplates(category?: string) {
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    try {
      const url = category
        ? `/api/finance/email-templates?category=${category}`
        : '/api/finance/email-templates';
      const res = await fetch(url);
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch {
      setTemplates([]);
    }
    setLoading(false);
  }, [category]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const defaultTemplate = useCallback((cat: string): EmailTemplate => {
    const saved = templates.find((t) => t.category === cat && t.is_category_default);
    if (saved) return toEmailTemplate(saved);
    return FALLBACKS[cat] ?? BILLING_TEMPLATE;
  }, [templates]);

  const presetsForCategory = useCallback((cat: string) => {
    return templates
      .filter((t) => t.category === cat)
      .map((t) => ({
        label: t.name + (t.is_category_default ? ' (Default)' : ''),
        value: String(t.id),
        template: toEmailTemplate(t),
      }));
  }, [templates]);

  return { templates, loading, refetch: fetchTemplates, defaultTemplate, presetsForCategory };
}
