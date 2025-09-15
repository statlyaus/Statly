// eslint.config.js (Flat Config)
import js from '@eslint/js';
import globals from 'globals';

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import a11yPlugin from 'eslint-plugin-jsx-a11y';
import nextPlugin from '@next/eslint-plugin-next';
import importPlugin from 'eslint-plugin-import';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // 0) Ignore junk and build outputs
  {
    ignores: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.vercel/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/public/**',
      '**/out/**',
      '**/Statly.worktrees/**',
      // local config/meta files
      'eslint.config.js',
      'tailwind.config.*',
      'next.config.*',
      'postcss.config.*',
      'index.tsx',
    ],
  },

  // 1) Base pass (no type info) — fast, runs everywhere
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': a11yPlugin,
      import: importPlugin,
      '@next/next': nextPlugin,
    },
    settings: {
      react: { version: 'detect' },
      // Path alias resolution for eslint-plugin-import
      'import/resolver': {
        typescript: {
          // keep these in sync with your tsconfig “paths”
          project: [
            path.join(__dirname, 'tsconfig.json'),
            path.join(__dirname, 'tsconfig.app.json'),
            path.join(__dirname, 'tsconfig.test.json'),
          ],
          alwaysTryTypes: true,
        },
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
    rules: {
      // Recommended cores
      ...js.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...a11yPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      // Modern JSX transform
      'react/react-in-jsx-scope': 'off',

      // Hooks deps guidance
      'react-hooks/exhaustive-deps': 'warn',

      // Imports: quality & consistency
      'import/no-unresolved': 'error',
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'object',
            'type',
          ],
          pathGroups: [
            { pattern: 'react', group: 'external', position: 'before' },
            { pattern: 'next/**', group: 'external', position: 'before' },
            { pattern: '@/**', group: 'internal' },
            { pattern: '@server/**', group: 'internal' },
            { pattern: '@lib/**', group: 'internal' },
            { pattern: '@contexts/**', group: 'internal' },
            { pattern: '@components/**', group: 'internal' },
            { pattern: '@types/**', group: 'type' },
          ],
          pathGroupsExcludedImportTypes: ['react'],
          alphabetize: { order: 'asc', caseInsensitive: true },
          'newlines-between': 'always',
        },
      ],
    },
  },

  // 2) Type-aware pass (precise) — limit to src
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: path.join(__dirname, 'tsconfig.json'),
        tsconfigRootDir: __dirname,
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'jsx-a11y': a11yPlugin,
      import: importPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // Hygiene
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      '@typescript-eslint/no-floating-promises': ['warn', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'warn',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',

      // a11y strictness (keep scope rule on)
      'jsx-a11y/scope': 'error',
    },
  },

  // 3) Client files — forbid importing server-only modules
  {
    files: [
      // Common client locations
      'src/components/**/*.{ts,tsx,js,jsx}',
      'src/contexts/**/*.{ts,tsx,js,jsx}',
      'src/app/**/components/**/*.{ts,tsx,js,jsx}',
      // Any file that explicitly declares a client module
      // (We can't match "use client" via glob; rely on directories for now)
    ],
    plugins: { import: importPlugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@server/*',
                // prevent reaching into server with relatives from client
                '../server/*',
                '../../server/*',
                '../../../server/*',
              ],
              message:
                'Do not import server-only code into client components. Use an API route or shared @lib/* module.',
            },
          ],
        },
      ],
    },
  },

  // 4) Server files — prevent importing client UI
  {
    files: ['src/server/**/*.{ts,tsx,js,jsx}', 'src/app/api/**/*.{ts,tsx,js,jsx}'],
    plugins: { import: importPlugin },
    settings: {
      // Helps the restricted paths rule resolve absolute paths correctly
      'import/resolver': {
        typescript: {
          project: [path.join(__dirname, 'tsconfig.json')],
        },
      },
    },
    rules: {
      // Block importing client-side UI from server code
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: './src/server', from: './src/components' },
            { target: './src/server', from: './src/contexts' },
            { target: './src/app/api', from: './src/components' },
            { target: './src/app/api', from: './src/contexts' },
          ],
          // Note: import/no-restricted-paths does not support a custom message field in flat config
        },
      ],
    },
  },

  // 5) Tests (Vitest/Jest) — type-aware via dedicated tsconfig
  {
    files: ['**/*.{test,spec}.{ts,tsx,js,jsx}', '**/__tests__/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: path.join(__dirname, 'tsconfig.test.json'),
        tsconfigRootDir: __dirname,
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.vitest, ...globals.node },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // 6) Types folder — enforce types-only and import type
  {
    files: ['src/types/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Do not export default values from src/types — types only.',
        },
        {
          selector: 'ExportNamedDeclaration > VariableDeclaration',
          message: 'No value exports in src/types; export only types/interfaces.',
        },
        {
          selector: 'ExportNamedDeclaration > FunctionDeclaration',
          message: 'No functions in src/types; keep it types-only.',
        },
        {
          selector: 'ExportNamedDeclaration > ClassDeclaration',
          message: 'No classes in src/types; keep it types-only.',
        },
      ],
    },
  },
];
