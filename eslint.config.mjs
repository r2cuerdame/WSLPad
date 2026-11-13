import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.loop/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'test/unit/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*', 'test/**/*.ts'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    // Every child process starts through src/main/hidden-process.ts, which owns
    // the no-console-window rules (windowsHide, piped stdio, never detached or
    // shell). test/unit/main/hidden-process.test.ts also catches require() and
    // dynamic import(), and holds tests and scripts to windowsHide: true.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/main/hidden-process.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: ['child_process', 'node:child_process'].map((name) => ({
            name,
            allowTypeImports: true,
            message: 'Start processes through src/main/hidden-process.ts so no console window can appear.'
          }))
        }
      ]
    }
  }
)
