'use client';

import { DetailPaneProvider } from './DetailPaneContext';
import { DeliverableUpdatesProvider } from './DeliverableUpdatesContext';
import dynamic from 'next/dynamic';
import ChatProvider from './chat/ChatProvider';
import QuickCreateFAB from './QuickCreateFAB';

// Both stay hidden until opened, so they load after the page instead of in its first bundle.
const DetailPane = dynamic(() => import('./DetailPane'), { ssr: false });
const ChatPanel = dynamic(() => import('./chat/ChatPanel'), { ssr: false });

export default function DetailPaneWrapper({ children }: { children: React.ReactNode }) {
  return (
    <DetailPaneProvider>
      <DeliverableUpdatesProvider>
        <ChatProvider>
          {children}
          <DetailPane />
          <ChatPanel />
          <QuickCreateFAB />
        </ChatProvider>
      </DeliverableUpdatesProvider>
    </DetailPaneProvider>
  );
}
