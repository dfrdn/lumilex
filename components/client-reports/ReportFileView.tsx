'use client';

const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const PDF = /\.pdf$/i;

/** One file of a report, shown in place: a PDF in the browser's viewer, an image fitted to the pane, anything else named. */
export default function ReportFileView({ url, name }: { url: string; name: string }) {
  if (PDF.test(name)) return <iframe key={url} src={url} title={name} className="block w-full h-full min-h-[60vh] border-0" />;
  if (IMAGE.test(name)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="block max-w-full mx-auto my-4 shadow-sm" />;
  }
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-stone-500 dark:text-stone-400">
      {name} can’t be shown here.
      <a href={url} target="_blank" rel="noreferrer" className="text-navy-700 dark:text-navy-300 hover:underline">Open it</a>
    </div>
  );
}

/** The tab strip over a report's files — the letter, then each annex. */
export function reportTabClass(on: boolean): string {
  return `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs cursor-pointer max-w-[16rem] ${
    on ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/5'
  }`;
}
