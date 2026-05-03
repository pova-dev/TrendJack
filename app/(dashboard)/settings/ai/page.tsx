import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { listCredentials } from '@/lib/credentials';
import { AiSettings } from '@/components/settings/AiSettings';

export default async function AiSettingsPage() {
  const ctx = await requireBrand();
  const creds = await listCredentials(ctx.org!.id);
  return (
    <div className="p-6 max-w-5xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink-100">AI providers</h1>
        <p className="text-sm text-ink-300">
          Add your own keys. Each provider unlocks the AI co-pilot, web research,
          draft generation, and the live tone tester. Stored encrypted (AES-256-GCM).
        </p>
      </header>
      <AiSettings initial={creds} />
    </div>
  );
}
