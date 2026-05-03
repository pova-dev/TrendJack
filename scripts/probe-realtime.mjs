import { GoogleTrendsRealtimeConnector } from '../lib/connectors/googletrends-realtime.ts';
const c = new GoogleTrendsRealtimeConnector();
const r = await c.poll({ brandKeywords: ['POVA'], competitors: [], geo: 'IN', emitAll: true });
console.log('ok:', r.ok);
if (r.ok) {
  console.log('signals:', r.signals.length);
  console.log('top 5:');
  for (const s of r.signals.slice(0,5)) {
    console.log(' ', JSON.stringify({ title: s.title, reach: s.reach, lineage: s.lineage.slice(0,80) }));
  }
} else {
  console.log('reason:', r.reason);
}
