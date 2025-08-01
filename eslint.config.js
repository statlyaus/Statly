import eslintPluginReact from 'eslint-plugin-react';

export default [
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react: eslintPluginReact,
    },
    languageOptions: {
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        project: './tsconfig.json',
      },
    },
    rules: {
      // Add your preferred rules here
      'react/react-in-jsx-scope': 'off',
    },
  },
];