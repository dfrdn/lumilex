/**
 * Minimal layout for admin detail embed (used in iframe).
 * Inherits the admin auth guard from app/admin/layout.tsx but adds no chrome.
 */
export default function AdminDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
