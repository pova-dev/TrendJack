// One-shot migration: relax First-Mover Window thresholds (was producing
// an empty column for POVA) and inject a fresh "Trending Now · India"
// column with category + window filters wired up.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const board = await prisma.board.findFirst();
if (!board) { console.log('no board'); process.exit(0); }

const cols = JSON.parse(board.columns);

// Fix First-Mover Window — drop the hard minReach:2000 and minOpportunity:20
// that left the column empty after primary lanes claimed every high-reach
// trend. Now firstMoverOnly + maxRisk:0.6 is the floor, so reddit-volume
// trends qualify too.
const fmw = cols.find(c => c.type === 'first_mover_window');
if (fmw) {
  fmw.filters = { firstMoverOnly: true, maxRisk: 0.6 };
}

// Add Trending Now · India if not already there.
if (!cols.find(c => c.id === 'col_gtrends_now')) {
  // Insert right after the existing Google Trends column for visual
  // grouping. Falls back to end-of-list if not present.
  const gtIdx = cols.findIndex(c => c.id === 'col_gtrends');
  const newCol = {
    id: 'col_gtrends_now',
    type: 'custom',
    title: 'Trending Now',
    refreshSec: 90,
    filters: {
      sources: ['google_trends'],
      gtrendsCategory: 'top',
      windowHours: 24,
    },
    sort: { key: 'firstSeenAt', dir: 'desc' },
  };
  if (gtIdx >= 0) {
    cols.splice(gtIdx + 1, 0, newCol);
  } else {
    cols.push(newCol);
  }
}

await prisma.board.update({
  where: { id: board.id },
  data: { columns: JSON.stringify(cols) },
});
console.log('patched. columns now:', cols.map(c => c.id).join(', '));
