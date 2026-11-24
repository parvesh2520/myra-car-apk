// Copies the MYRA UI build (web-dist/, made by `npm run build:car` in ../web) into the APK's assets, where the
// WebView loads it from file:///android_asset/web/index.html. Runs during `expo prebuild` (also on EAS Build).
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

module.exports = function withMyraWebUI(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, 'web-dist');
      if (!fs.existsSync(path.join(src, 'index.html'))) {
        throw new Error('app/web-dist/index.html is missing: run `npm run build:car` in ../web first.');
      }
      const dest = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets', 'web');
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
      return cfg;
    },
  ]);
};
