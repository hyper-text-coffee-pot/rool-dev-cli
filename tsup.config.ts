import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/app/index.ts'], // <-- points inside src/app/
  format: ['esm', 'cjs'], // cjs build is used to produce the standalone .exe (Node SEA requires CJS)
  target: 'node18',
  clean: true,
  noExternal: [/.*/], // bundle all deps in-file — the .exe has no node_modules to resolve from
  banner: {
    js: '#!/usr/bin/env node',
  },
});
