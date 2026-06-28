import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  // Relative base so the build works under any GitHub Pages subpath
  // (https://<user>.github.io/<repo>/) without hardcoding the repo name.
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: { host: true, port: 5173 },
}))
