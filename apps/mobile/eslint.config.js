import reactConfig from '@pc-control/eslint-config/react';

export default [
  {
    ignores: ['android/**', 'dist/**'],
  },
  ...reactConfig,
];
