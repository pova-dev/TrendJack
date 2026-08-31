// Shown while a route's server component is still resolving.
//
// Without one, Next.js holds the previous page on screen until the new one is
// ready and nothing indicates anything is happening. The board queries 200
// trends and the landing view runs six counts, so that pause is long enough to
// read as a frozen app rather than a loading one, and users click again.
//
// This is deliberately structural rather than a spinner: matching the shape of
// what is arriving makes the swap feel like content filling in instead of one
// screen replacing another. Blocks are sized to the real layout, so nothing
// jumps when the data lands.

export function RouteSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex-1 overflow-hidden" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-8">
        <Block className="h-3 w-32" />
        <Block className="mt-3 h-7 w-56" />
        <Block className="mt-2.5 h-4 w-72" />

        <div className="mt-8 space-y-2">
          {Array.from({ length: rows }, (_, i) => (
            <Block key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Block className="h-32 rounded-lg" />
          <Block className="h-32 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * A placeholder block.
 *
 * Pulsing opacity rather than a sweeping gradient: a shimmer that travels
 * draws the eye along it, which is exactly the wrong thing to do while asking
 * someone to wait. The animation also runs on the container so every block
 * breathes together instead of each keeping its own time.
 */
function Block({ className = '' }: { className?: string }) {
  return <div className={`bg-ink-800 rounded motion-safe:animate-pulse-slow ${className}`} />;
}
