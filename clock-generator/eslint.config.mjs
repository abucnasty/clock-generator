import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      // the modes, evaluators and plugins implement interfaces whose methods take what they may not need
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
