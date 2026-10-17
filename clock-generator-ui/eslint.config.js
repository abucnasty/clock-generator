import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
      // an inline `type` import leaves a side-effect import behind, which would bundle the module anyway
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  {
    // The engine is bundled once, in the simulation worker: the main thread takes only types from it, and its
    // values from the small 'clock-generator/light' entry. The tests run in Node and can use the engine directly.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/worker/simulation.worker.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        paths: ['clock-generator', 'clock-generator/browser'].map((name) => ({
          name,
          allowTypeImports: true,
          message: 'Import only types from the engine here; take values from clock-generator/light or ask the worker.',
        })),
      }],
      'no-restricted-syntax': ['error', {
        selector: "ImportExpression[source.value='clock-generator'], ImportExpression[source.value='clock-generator/browser']",
        message: 'Only the simulation worker loads the engine.',
      }],
    },
  },
])
