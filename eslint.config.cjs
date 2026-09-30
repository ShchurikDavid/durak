const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'public/cards/**'] },
  {
    files: [
      'server.js',
      'src/**/*.js',
      'test/**/*.js',
      '*.cjs',
      '*.config.js',
      'mobile/local-game.js',
      'mobile/bluetooth-host.js',
      'mobile/hand-layout.js',
      'mobile/table-layout.js'
    ],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }]
    }
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }]
    }
  }
];
