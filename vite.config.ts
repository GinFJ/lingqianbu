import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    modulePreload: {
      resolveDependencies(_filename, dependencies, context) {
        if (context.hostType !== 'html') return dependencies
        return dependencies.filter((dependency) => !dependency.includes('/charts-'))
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          storage: ['dexie', 'papaparse'],
          sync: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
