'use client';

import { createRoot } from 'react-dom/client';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

/**
 * Ask before something that can't be taken back, in the app's own dialog
 * rather than the browser's. Resolves true on confirm, false on cancel,
 * Escape or a click outside.
 *
 *   if (!(await confirmAction({ title: 'Remove this file?', confirmLabel: 'Remove', danger: true }))) return;
 */
export function confirmAction({
  title,
  message = '',
  confirmLabel = 'Confirm',
  danger = false,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const settle = (ok: boolean) => {
      resolve(ok);
      // Unmount after the click that settled it has finished propagating.
      setTimeout(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(
      <ConfirmDialog
        open
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        variant={danger ? 'danger' : 'navy'}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />,
    );
  });
}
