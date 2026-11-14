import { defineConfig } from 'vite';
import { lunyxApi } from './server/plugin';

export default defineConfig({
  plugins: [lunyxApi()],
});
