const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * React Native's Gradle plugin defaults its bundler/codegen executable to
 * `node`. This project's host runtime is Bun, so force every generated Gradle
 * task that invokes JavaScript to use `bun --bun` instead.
 */
module.exports = function withBunGradle(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (/^\s*nodeExecutableAndArgs\.set\(/m.test(contents)) return config;
    const match = /react\s*\{/.exec(contents);
    if (!match) {
      throw new Error('withBunGradle: android/app/build.gradle has no react block');
    }
    const insertAt = match.index + match[0].length;
    const withExecutable =
      contents.slice(0, insertAt) +
      '\n    nodeExecutableAndArgs.set(["bun", "--bun"])' +
      contents.slice(insertAt);
    // Expo's template also shells out to node while resolving entryFile,
    // react-native, Hermes, codegen and the Expo CLI inside react {}. Those
    // calls do not read nodeExecutableAndArgs, so rewrite them in place.
    config.modResults.contents =
      withExecutable.slice(0, insertAt) +
      withExecutable
        .slice(insertAt)
        .replaceAll('["node",', '["bun", "--bun",');
    return config;
  });
};
