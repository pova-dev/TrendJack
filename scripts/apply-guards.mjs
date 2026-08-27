// One-off codemod: insert a capability guard into every unguarded mutating
// route handler. Kept in the repo so the mapping is reviewable rather than
// buried in a shell transcript.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = resolve('app/api');

// route file → capability. Chosen by what the route actually does, not by
// which HTTP verb it uses.
const MAP = {
  'boards/reset/route.ts':               'board:edit',
  'boards/route.ts':                     'board:edit',
  'brand/route.ts':                      'brand:edit',
  'brand/voice-lint/route.ts':           'draft:create',
  'connectors/test/[source]/route.ts':   'credential:write',
  'copilot/route.ts':                    'draft:create',
  'credentials/route.ts':                'credential:write',
  'geo/run/route.ts':                    'draft:create',
  'integrations/[type]/route.ts':        'trend:act',
  'refresh/route.ts':                    'trend:act',
  'rescore/route.ts':                    'scoring:edit',
  'social/accounts/route.ts':            'social:manage',
  'social/intelligence/route.ts':        'draft:create',
  'telegram/route.ts':                   'credential:write',
  'telegram/test/route.ts':              'credential:write',
  'trends/[id]/actions/route.ts':        'trend:act',
  'trends/[id]/battle-card/route.ts':    'draft:create',
  'trends/[id]/generate/route.ts':       'draft:create',
  'trends/[id]/lineage/route.ts':        'draft:create',
  'trends/[id]/research/route.ts':       'draft:create',
  'trends/[id]/room/presence/route.ts':  'room:comment',
  'trends/[id]/room/route.ts':           'room:comment',
  'webhooks/route.ts':                   'credential:write',
};

const IMPORT = "import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';";

let touched = 0;
for (const [rel, capability] of Object.entries(MAP)) {
  const file = resolve(API, rel);
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { console.log(`  MISSING ${rel}`); continue; }

  if (src.includes('requireCapability')) { console.log(`  already guarded ${rel}`); continue; }

  // Add the import after the last existing import line.
  const importLines = [...src.matchAll(/^import .*?;$/gm)];
  if (importLines.length) {
    const last = importLines[importLines.length - 1];
    const at = last.index + last[0].length;
    src = src.slice(0, at) + '\n' + IMPORT + src.slice(at);
  } else {
    src = IMPORT + '\n' + src;
  }

  // Insert the guard as the first statement of each mutating handler.
  const guard = (cap) => `
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('${cap}'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }
`;

  const before = src;
  src = src.replace(
    /(export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{)/g,
    (m) => m + guard(capability),
  );

  if (src === before) { console.log(`  NO HANDLER MATCHED ${rel}`); continue; }

  writeFileSync(file, src);
  touched++;
  console.log(`  guarded ${rel}  ->  ${capability}`);
}
console.log(`\ntouched ${touched} files`);
