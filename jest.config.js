module.exports = {
  preset: "jest-expo",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // @candypoets/nipworker and its noble/scure/nostr-tools deps ship ESM; let
  // babel transform them like the RN/Expo packages.
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@candypoets|@noble|@scure|nostr-tools)",
  ],
  // Coverage must include unimported UI and integration modules too; otherwise
  // Jest reports only the already-tested dependency graph and overstates the
  // repository's actual unit-test reach.
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts", "!src/**/__tests__/**"],
  coverageThreshold: {
    global: {
      statements: 29,
      branches: 27,
      functions: 20,
      lines: 28,
    },
  },
};
