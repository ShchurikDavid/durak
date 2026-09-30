const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  maxWorkers: 2,
  resolver: { blockList: [/[/\\]android[/\\].*[/\\]build[/\\].*/, /[/\\]data[/\\].*/] }
});
