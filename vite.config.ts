import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if (command === 'build' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error(
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before building Agape.',
    )
  }
  return {
    plugins: [react()],
    base: process.env.PAGES_BASE_PATH || '/',
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            markdown: ['react-markdown'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
  }
})
