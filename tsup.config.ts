import { defineConfig } from 'tsup';

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
  banner(ctx) {
    if (ctx.format === 'esm') {
      return { js: '#!/usr/bin/env node' };
    }
    return {};
  },
});
