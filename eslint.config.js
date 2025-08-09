// eslint.config.js
import js from '@eslint/js';
import globals from 'globals';

import parser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

import eslintPluginReact from 'eslint-plugin-react';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginJsxA11y from 'eslint-plugin-jsx-a11y';

import nextPlugin from '@next/eslint-plugin-next';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // Ignore build artifact directories and config files
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/coverage/**',
      '**/public/**',
      'out/**',
      // local config/meta files
      'eslint.config.js',
      '.eslintrc.js',
      'tailwind.config.*',
      'next.config.*',
      'postcss.config.*',
      'index.tsx',
    ],
  },

  // Base config shared by JS/TS/JSX/TSX
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        // enable type-aware rules
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
      react: eslintPluginReact,
      'react-hooks': eslintPluginReactHooks,
      'jsx-a11y': eslintPluginJsxA11y,
      '@next/next': nextPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Base recommended sets
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...eslintPluginReact.configs.recommended.rules,
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginJsxA11y.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      // React 17+ / Next uses the new JSX transform
      'react/react-in-jsx-scope': 'off',

      // Next relaxations
      '@next/next/no-html-link-for-pages': 'off',

      // TS hygiene
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',

      // Hook deps should be a nudge, not a block
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // TS/TSX-specific overrides
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // We use TypeScript instead of prop-types
      'react/prop-types': 'off',

      // TS handles undefined variables; rule is noisy with types
      'no-undef': 'off',

      // If you want to move fast, you can relax this (set to 'off' or 'warn')
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];