import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/2026-Sailing/',  // GitHub Pages serves from /repo-name/
  plugins: [react()],
})
