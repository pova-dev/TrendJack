import { RouteSkeleton } from '@/components/shell/RouteSkeleton';

// Covers every dashboard route that does not define its own. The shell, header
// and navigation stay mounted throughout, so only the content region swaps.
export default function Loading() {
  return <RouteSkeleton />;
}
