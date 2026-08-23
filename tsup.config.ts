import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/app/index.ts'], // <-- points inside src/app/
  format: ['esm'],
  target: 'node18',
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
