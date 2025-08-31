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
      'functions/**/*',
      'tests/setup/**/*',
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

      // Disable exhaustive-deps warnings
      'react-hooks/exhaustive-deps': 'off',
      'no-console': 'off',

      // jsx-a11y specific rules
      'jsx-a11y/scope': 'error',
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
      'jsx-a11y': a11yPlugin,
    },
    rules: {
      // TS recommended (type-aware)
      ...tsPlugin.configs.recommended.rules,

      // jsx-a11y rules for type-aware pass
      ...a11yPlugin.configs.recommended.rules,

      // Use TS instead of prop-types
      'react/prop-types': 'off',

      // TS handles undefined vars; disabling avoids noise with types
      'no-undef': 'off',

      // Hygiene
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-misused-promises': 'off',

      'react-hooks/exhaustive-deps': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'react/no-unescaped-entities': 'off',
      'jsx-a11y/no-noninteractive-element-to-interactive-role': 'off',
      'jsx-a11y/no-redundant-roles': 'off',
      'jsx-a11y/no-noninteractive-tabindex': 'off',
      'jsx-a11y/scope': 'error',
      'no-console': 'off',
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
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];
