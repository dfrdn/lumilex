import { SOURCE_URL } from '@/lib/source';

/** "Source code · AGPL-3.0", linking to this instance's source (lib/source.ts). */
export default function SourceLink({ className }: { className?: string }) {
  return (
    <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={className}>
      Source code · AGPL-3.0
    </a>
  );
}
