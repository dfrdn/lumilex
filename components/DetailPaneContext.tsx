'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';

interface PaneState {
  entity: string;
  id: string;
}

interface DetailPaneContextValue {
  pane: PaneState | null;
  openPane: (entity: string, id: string) => void;
  closePane: () => void;
}

const DetailPaneContext = createContext<DetailPaneContextValue>({
  pane: null,
  openPane: () => {},
  closePane: () => {},
});

export function useDetailPane() {
  return useContext(DetailPaneContext);
}

export function DetailPaneProvider({ children }: { children: React.ReactNode }) {
  const [pane, setPane] = useState<PaneState | null>(null);
  const pathname = usePathname();

  const openPane = useCallback((entity: string, id: string) => {
    setPane({ entity, id });
  }, []);

  const closePane = useCallback(() => {
    setPane(null);
  }, []);

  // Auto-close when navigating to a different page
  useEffect(() => {
    setPane(null);
  }, [pathname]);

  return (
    <DetailPaneContext.Provider value={{ pane, openPane, closePane }}>
      {children}
    </DetailPaneContext.Provider>
  );
}
