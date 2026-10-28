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
  {
    // the build is CommonJS: a local named exports, module or require hides the module's own, and tsc's output then
    // reads the local where the source reads one of the module's exports
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: ':matches(VariableDeclarator > Identifier.id, FunctionDeclaration > Identifier.id, ClassDeclaration > Identifier.id, :function > Identifier.params)[name=/^(exports|module|require)$/]',
        message: 'The build is CommonJS: do not name a local exports, module or require.',
      }],
    },
  },
])
