const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// A locally linked nipworker lives outside this project, so Metro would
// otherwise resolve its peer dependencies from the library checkout. Keep
// local-link testing on the same React Native/FlatBuffers instances as Board.
if (process.env.NIPWORKER_LOCAL_PATH) {
  config.watchFolders = [
    ...(config.watchFolders ?? []),
    path.resolve(process.env.NIPWORKER_LOCAL_PATH),
  ];
  config.resolver = {
    ...config.resolver,
    unstable_enableSymlinks: true,
    extraNodeModules: {
      ...(config.resolver?.extraNodeModules ?? {}),
      react: path.resolve(__dirname, "node_modules/react"),
      "react-native": path.resolve(__dirname, "node_modules/react-native"),
      flatbuffers: path.resolve(__dirname, "node_modules/flatbuffers"),
    },
  };
}

module.exports = withNativeWind(config, { input: "./global.css" });
