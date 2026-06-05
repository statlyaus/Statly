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
      'functions/lib/**',
      '**/functions/lib/**',
      '.next/**',
      '**/.next/**',
      '.turbo/**',
      '**/.turbo/**',
      '.netlify/**',
      '**/.netlify/**',
      '.vercel/**',
      '**/.vercel/**',
      '.firebase/**',
      '**/.firebase/**',
      '.firebase-data/**',
      '**/.firebase-data/**',
      '.codex/**',
      '**/.codex/**',
      '.superpowers/**',
      '**/.superpowers/**',
      '.vibe/**',
      '**/.vibe/**',
      '**/build/**',
      '**/coverage/**',
      '**/functions/lib/**',
      '**/public/**',
      '**/out/**',
      '**/Statly.worktrees/**',
      '**/firebase-export-*/**',
      '**/graphify-out/**',
      '**/tmp/**',
      // local config/meta files
      'eslint.config.js',
      'tailwind.config.*',
      'next.config.*',
      'postcss.config.*',
      'index.tsx',
    ],
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
      ...js.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...a11yPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      'react/react-in-jsx-scope': 'off',
      '@next/next/no-html-link-for-pages': 'off',
      'react-hooks/exhaustive-deps': 'warn',

      // Accessibility
      'jsx-a11y/scope': 'error',
    },
  },

  // TypeScript handles symbols through the TypeScript-aware rules below.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },

  // 3) Type-aware pass (only for src)
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
      ...tsPlugin.configs.recommended.rules,
      ...a11yPlugin.configs.recommended.rules,

      'react/prop-types': 'off',
      'no-undef': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      '@typescript-eslint/no-floating-promises': ['warn', { ignoreVoid: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-misused-promises': [
        'warn',
        { checksVoidReturn: { attributes: false } },
      ],

      // Accessibility
      'jsx-a11y/scope': 'error',
    },
  },

  // 3b) Tests (Vitest)
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
