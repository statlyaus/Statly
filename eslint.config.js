// eslint.config.js
import js from '@eslint/js';
import globals from 'globals';

import parser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import a11yPlugin from 'eslint-plugin-jsx-a11y';
import nextPlugin from '@next/eslint-plugin-next';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // 1) Ignore junk and build outputs
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.vercel/**',
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
    plugins: {
      '@next/next': nextPlugin,
    },
  },

  // 2) Base pass (no type info) — fast, runs on everything
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        // no `project` here — keeps this pass fast
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
      '@next/next': nextPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Recommended cores
      ...js.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...a11yPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      // Modern JSX transform (no need to import React)
      'react/react-in-jsx-scope': 'off',

      // Next relaxations
      '@next/next/no-html-link-for-pages': 'off',

      // Hook deps should be guidance, not hard fail
      'react-hooks/exhaustive-deps': 'warn',

      // Downgrade noisy rules to warnings
      'react/no-unescaped-entities': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'no-unused-vars': 'warn',
      'no-unsafe-finally': 'warn',
      'no-case-declarations': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-tabindex': 'warn',

      // JSX accessibility rules that apply to all JSX files
      // Note: jsx-a11y/scope is not a valid rule - removed
    },
  },

  // 3) Type-aware pass (only for src) — slower but precise
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
    },
    rules: {
      // TS recommended (type-aware)
      ...tsPlugin.configs.recommended.rules,

      // Use TS instead of prop-types
      'react/prop-types': 'off',

      // TS handles undefined vars; disabling avoids noise with types
      'no-undef': 'off',

      // Keep velocity but still nudge away from `any`
      '@typescript-eslint/no-explicit-any': 'warn',

      // Nice DX for async handlers in React
      '@typescript-eslint/no-misused-promises': [
        'warn',
        { checksVoidReturn: { attributes: false } },
      ],

      // Restored hygiene rules
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
    },
  },

  // 3b) Tests (Vitest) — type-aware using tests tsconfig; supports ts/tsx/js/jsx
  {
    files: ['**/*.{test,spec}.{ts,tsx,js,jsx}', '**/__tests__/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        project: './tsconfig.test.json',
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.vitest,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];
