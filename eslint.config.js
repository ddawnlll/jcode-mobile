// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    files: ['plugins/**/*.js', 'scripts/**/*.js', 'jest.setup.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
  {
    ignores: ['dist/*', 'ios/*', 'android/*', '.expo/*', 'node_modules/*', 'artifacts/*'],
    rules: {
      // The React Compiler rules below reject APIs this project intentionally
      // uses: Reanimated shared-value mutation in gestures, and state resets
      // when a sheet closes. React Compiler is not enabled in this app.
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      // House style uses readonly Array<T> in several public signatures.
      '@typescript-eslint/array-type': 'off',
      'import/no-duplicates': 'error',
    },
  },
]);
