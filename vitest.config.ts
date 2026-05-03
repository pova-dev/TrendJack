import { defineConfig } from 'vitest/config';
import path from 'path';

// Vitest config — kept deliberately minimal. We need:
//   - the @/ path alias to resolve like the Next.js tsconfig does
//   - node-style modules (no JSDOM yet — we're testing pure logic)
//   - excludes that match what the Next dev server already excludes
//
// To run:    npm test           (single pass)
//            npm run test:watch (re-run on save)
//            npm run test:cov   (with coverage report)
export default defineConfig({
  resolve: {
    alias: {
      '@':         path.resolve(__dirname, '.'),
      '@core':     path.resolve(__dirname, 'src/core'),
      '@agents':   path.resolve(__dirname, 'src/agents'),
      '@connectors': path.resolve(__dirname, 'src/connectors'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**', 'lib/scoring/**'],
      exclude: ['**/*.test.ts', '**/types.ts', '**/index.ts'],
    },
  },
});
