import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';

const TYPESCRIPT = ['src/renderer/**/*.{ts,tsx}', 'scripts/**/*.ts'];

export default [
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'python/**'] },
  js.configs.recommended,
  {
    files: ['src/main/**/*.js', 'electron.vite.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['src/preload/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: TYPESCRIPT })),
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  eslintConfigPrettier,
];
