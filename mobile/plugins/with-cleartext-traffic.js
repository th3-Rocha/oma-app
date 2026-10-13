const { withAndroidManifest } = require("@expo/config-plugins");

// The backend is plain http on the LAN; Android blocks that unless the app opts in.
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$ = application.$ || {};
      application.$["android:usesCleartextTraffic"] = "true";
    }
    return config;
  });
};
