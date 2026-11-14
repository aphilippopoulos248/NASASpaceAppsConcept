import { defineConfig } from 'vite';
import { lunyxApi } from './server/plugin';

export default defineConfig({
  plugins: [lunyxApi()],
  server: {
    watch: {
      // Large generated folders the dev server has no reason to watch. Watching a folder on
      // Windows also holds file handles on it, which can block other tools from renaming things inside.
      ignored: ['**/target/**', '**/scripts/.cache/**'],
    },
  },
});
