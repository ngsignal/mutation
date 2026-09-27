import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// CI job running the suite on RxJS 6. Angular's ESM imports `rxjs/operators`, a directory that
// RxJS 6 (no `exports` map) can't serve to Node's ESM resolver: let Vite resolve Angular instead.
export default mergeConfig(
  baseConfig,
  defineConfig({ test: { server: { deps: { inline: [/@angular\//] } } } }),
);
