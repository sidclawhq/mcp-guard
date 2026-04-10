import { defineConfig } from 'tsup';
import { writeFileSync, readFileSync } from 'node:fs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'mock-server': 'src/mock-server.ts',
  },
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  async onSuccess() {
    // Add shebang only to cli.js (not index.js or mock-server.js)
    const cliPath = 'dist/cli.js';
    const content = readFileSync(cliPath, 'utf-8');
    if (!content.startsWith('#!')) {
      writeFileSync(cliPath, '#!/usr/bin/env node\n' + content);
    }
  },
});
