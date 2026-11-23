/**
 * supabase-js constructs a RealtimeClient in its constructor, which throws on
 * Node < 22 unless a WebSocket implementation is supplied. The verification
 * probes never use realtime, but they do call createClient — so on the Node 20
 * the repo pins (see run-dev.sh) `npm run verify` died before its first check.
 *
 * Importing this module first installs `ws` as the global WebSocket when the
 * runtime lacks a native one, so the probes run on either Node version.
 */
import WebSocket from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}
