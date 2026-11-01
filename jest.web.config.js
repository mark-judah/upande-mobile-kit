// Server-render smoke tests of the screens through react-native-web (no native renderer needed).
module.exports = {
  preset: 'jest-expo/web',
  testMatch: ['<rootDir>/__tests__/web/**/*-test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|react-native-web)',
  ],
};
