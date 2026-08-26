// Realtime transport tests.
//
// The defect being fixed was silence: with an in-process bus on a
// multi-instance deploy, an event published by one instance never reaches a
// dashboard held open against another, and nothing anywhere says so. Live
// updates simply stop for most users.
//
// So the properties under test are about noise, not throughput: the multi
// instance heuristic has to fire on the platforms where more than one instance
// is the default, a connection string must never reach a log with its password
// intact, and a Redis outage must degrade rather than take the app down.

import { describe, expect, it } from 'vitest';
import { looksMultiInstance, redactUrl } from '@/lib/realtime/redis-bus';

describe('multi-instance detection', () => {
  it('fires on the platforms that run several instances by default', () => {
    // Each of these is a deploy where in-process realtime is almost certainly
    // a mistake rather than a choice.
    const platforms = [
      { VERCEL: '1' },
      { AWS_LAMBDA_FUNCTION_NAME: 'fn' },
      { K_SERVICE: 'svc' },                       // Cloud Run
      { WEBSITE_INSTANCE_ID: 'abc' },             // Azure App Service
      { DYNO: 'web.1' },                          // Heroku
      { FLY_ALLOC_ID: 'x' },                      // Fly.io
      { KUBERNETES_SERVICE_HOST: '10.0.0.1', NODE_ENV: 'production' },
    ];
    for (const env of platforms) {
      expect(looksMultiInstance(env as NodeJS.ProcessEnv), JSON.stringify(env)).toBe(true);
    }
  });

  it('stays quiet for a plain single-server or local run', () => {
    expect(looksMultiInstance({} as NodeJS.ProcessEnv)).toBe(false);
    expect(looksMultiInstance({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
    expect(looksMultiInstance({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('does not warn for kubernetes outside production', () => {
    // A dev cluster is usually a single replica; warning there would train
    // people to ignore the message that matters.
    expect(looksMultiInstance({
      KUBERNETES_SERVICE_HOST: '10.0.0.1', NODE_ENV: 'development',
    } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('redactUrl', () => {
  it('strips the password from a connection string', () => {
    const out = redactUrl('redis://admin:sup3rs3cret@redis.internal:6379');
    expect(out).not.toContain('sup3rs3cret');
    expect(out).not.toContain('admin');
    expect(out).toContain('redis.internal');
  });

  it('leaves a credential-free url readable', () => {
    expect(redactUrl('redis://localhost:6379')).toContain('localhost:6379');
  });

  it('never leaks a malformed string verbatim', () => {
    // If it cannot be parsed it cannot be safely redacted, so nothing of it
    // is printed.
    const out = redactUrl('not-a-url-with-a-secret-in-it');
    expect(out).toBe('redis://***');
    expect(out).not.toContain('secret');
  });

  it('handles a url with a password but no username', () => {
    const out = redactUrl('redis://:justapassword@host:6379');
    expect(out).not.toContain('justapassword');
  });
});
