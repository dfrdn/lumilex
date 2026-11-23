import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Pure logic runs under Node. Component/DOM tests can opt into jsdom
    // per-file with a `// @vitest-environment jsdom` pragma when we add them.
    environment: 'node',
    include: [
      'lib/**/*.{test,spec}.{ts,tsx}',
      'app/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next', '.claude'],
  },
  resolve: {
    // Mirror the tsconfig `@/*` → `./*` path alias so tests can import the
    // same way app code does.
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
