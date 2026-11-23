/** Page body container — the same measure on every client-facing page. */
export function ClientPage({ children, narrow = false, className = '' }: { children: React.ReactNode; narrow?: boolean; className?: string }) {
  return (
    <main className={`${narrow ? 'max-w-3xl' : 'max-w-5xl'} mx-auto px-5 sm:px-6 py-10 sm:py-12 ${className}`}>
      {children}
    </main>
  );
}
