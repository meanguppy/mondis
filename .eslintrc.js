module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json'],
  },
  plugins: [
    '@typescript-eslint',
  ],
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    '@typescript-eslint/ban-types': [
      'error',
      {
        types: { '{}': false },
        extendDefaults: true,
      },
    ],
    '@typescript-eslint/lines-between-class-members': 0,
    '@typescript-eslint/no-non-null-assertion': 0,
    '@typescript-eslint/no-floating-promises': 0,
    '@typescript-eslint/naming-convention': 0,
    'class-methods-use-this': 0,
    'import/extensions': 0,
    'import/prefer-default-export': 0,
    'lines-between-class-members': 0,
    'no-param-reassign': 0,
    'no-underscore-dangle': 0,
    'no-restricted-syntax': 0,
    'max-classes-per-file': 0,
    'object-curly-newline': 0,
  },
  ignorePatterns: ['dist', '**/*.js'],
};
