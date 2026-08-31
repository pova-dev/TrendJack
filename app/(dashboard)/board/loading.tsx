// The board's own skeleton: columns, not stacked cards.
//
// Reusing the generic one would show three wide rows and then snap to a
// horizontal column layout, which is a worse transition than no skeleton at
// all. The widths match BoardColumn so nothing shifts when the real columns
// arrive.
export default function Loading() {
  return (
    <div className="flex flex-1 gap-2 overflow-hidden p-1.5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading board</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="flex-shrink-0 w-[calc(100vw-72px)] sm:w-[360px] rounded-lg border border-ink-700 bg-ink-850/60 p-3 motion-safe:animate-pulse-slow"
        >
          <div className="h-4 w-32 bg-ink-800 rounded" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }, (_, j) => (
              <div key={j} className="h-16 bg-ink-800/70 rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
