'use client';

import { useRef } from 'react';
import Button from './Button';
import Modal from './Modal';

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  /** The dismiss button; say what is kept when the confirm label is itself a "cancel". */
  cancelLabel?: string;
  variant?: 'primary' | 'danger' | 'navy';
  loading?: boolean;
  /** Holds the confirm button back, e.g. while a field below the message is invalid. */
  confirmDisabled?: boolean;
  /** What the confirmation needs besides a yes, under the message. */
  children?: React.ReactNode;
}

const CONFIRM_VARIANT = { primary: 'success', danger: 'danger', navy: 'primary' } as const;

export default function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  loading = false,
  confirmDisabled = false,
  children,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message || undefined}
      size="sm"
      showClose={false}
      divider={false}
      dismissible={!loading}
      initialFocusRef={confirmRef}
      bodyClassName={children ? 'px-6 pb-2' : 'px-6 pb-0'}
      footer={
        <>
          <Button variant="subtle" size="lg" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={CONFIRM_VARIANT[variant]} size="lg" onClick={onConfirm} disabled={loading || confirmDisabled}>
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing...
              </span>
            ) : (
              confirmLabel
            )}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
