'use client';

import { useCallback, useRef, useState } from 'react';

interface Options {
  /** Ignore drops while an upload is already running. */
  disabled?: boolean;
}

/**
 * Drop-target handlers for a region that accepts file drops.
 *
 * Uses an enter/leave counter rather than a boolean: dragging across a child
 * element fires dragleave on the parent, so a naive boolean makes the highlight
 * flicker on any region that isn't a single flat box.
 */
export function useFileDrop(onFiles: (files: File[]) => void, { disabled }: Options = {}) {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);

  const reset = useCallback(() => {
    depth.current = 0;
    setIsOver(false);
  }, []);

  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (disabled || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      depth.current += 1;
      setIsOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (disabled || !e.dataTransfer.types.includes('Files')) return;
      // Without this the browser opens the file instead of firing onDrop.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      depth.current -= 1;
      if (depth.current <= 0) reset();
    },
    onDrop: (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(files);
    },
  };

  return { isOver, dropProps };
}
