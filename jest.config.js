module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/*-test.ts', '<rootDir>/__tests__/*-test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*)',
  ],
};
