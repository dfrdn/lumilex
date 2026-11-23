'use client';

import { Suspense, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import dynamic from 'next/dynamic';
import type { SuperDocRef, SuperDocReadyEvent, SuperDocInstance } from '@superdoc/react';
import { Loader2 } from 'lucide-react';

const editorLoading = (
  <div className="flex items-center justify-center h-64">
    <Loader2 className="w-6 h-6 animate-spin text-gold-500 dark:text-gold-400" />
  </div>
);

// Dynamic import to avoid SSR issues with SuperDoc
const SuperDocEditor = dynamic(
  () => import('@superdoc/react').then((mod) => mod.SuperDocEditor ?? mod.default),
  { ssr: false },
);

export interface SuperDocViewerHandle {
  /** Export the current document as a DOCX Blob */
  exportDocx: () => Promise<Blob | null>;
}

interface Props {
  /** The DOCX file to render */
  document: File | Blob | null;
  /** 'editing' for editable, 'viewing' for read-only */
  mode?: 'editing' | 'viewing';
  /** Called when the editor is ready */
  onReady?: () => void;
  /** Additional CSS class */
  className?: string;
}

const SuperDocViewer = forwardRef<SuperDocViewerHandle, Props>(
  function SuperDocViewer({ document: doc, mode = 'editing', onReady, className }, ref) {
    const sdRef = useRef<SuperDocRef>(null);
    const instanceRef = useRef<SuperDocInstance | null>(null);

    useImperativeHandle(ref, () => ({
      async exportDocx() {
        const instance = instanceRef.current ?? sdRef.current?.getInstance();
        if (!instance) return null;
        const blob = await instance.export({ triggerDownload: false });
        return blob instanceof Blob ? blob : null;
      },
    }));

    const handleReady = useCallback(
      (event: SuperDocReadyEvent) => {
        instanceRef.current = event.superdoc;
        onReady?.();
      },
      [onReady],
    );

    // SuperDocEditor destroys and rebuilds the editor whenever `document`
    // changes identity, so the File must survive re-renders of the calling
    // page — otherwise any parent state change reloads the document mid-edit
    // and discards what the user typed.
    const file = useMemo(() => {
      if (!doc) return null;
      return doc instanceof File ? doc : new File([doc], 'document.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    }, [doc]);

    if (!file) {
      return (
        <div className={`flex items-center justify-center h-full ${className ?? ''}`}>
          <Loader2 className="w-6 h-6 animate-spin text-gold-500 dark:text-gold-400" />
        </div>
      );
    }

    return (
      // SuperDoc paints white Word pages in both themes, and its caret takes the
      // inherited text colour — the app's dark-mode cream is invisible on white.
      <div className={`text-stone-900 ${className ?? ''}`}>
        {/* React suspends on a precedence stylesheet until it loads. Without a boundary here that
            reaches the route's loading.tsx on first open, which swaps out the calling page and loses its state. */}
        <Suspense fallback={editorLoading}>
          {/* Served by app/vendor/superdoc.css — the bundler can't parse this stylesheet. React hoists and dedupes it. */}
          {/* eslint-disable-next-line @next/next/no-css-tags */}
          <link rel="stylesheet" href="/vendor/superdoc.css" precedence="default" />
          <SuperDocEditor
            ref={sdRef}
            document={file}
            documentMode={mode}
            onReady={handleReady}
            renderLoading={() => editorLoading}
          />
        </Suspense>
      </div>
    );
  },
);

export default SuperDocViewer;
