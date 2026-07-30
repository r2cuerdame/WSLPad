import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    include: ['test/unit/**/*.test.{ts,tsx}', 'test/integration/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [['test/unit/renderer/**', 'jsdom']],
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000
  }
})
