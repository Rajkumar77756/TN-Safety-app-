const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withStealthMode(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;
    const application = androidManifest.application[0];

    // Ensure permissions
    if (!androidManifest['uses-permission']) {
      androidManifest['uses-permission'] = [];
    }
    androidManifest['uses-permission'].push({
      $: { 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW' }
    });

    // Add Services to Application
    if (!application.service) {
      application.service = [];
    }
    
    // Accessibility Service
    application.service.push({
      $: {
        'android:name': 'com.rajkumar.thunai.stealthmode.StealthModeAccessibilityService',
        'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
        'android:exported': 'true'
      },
      'intent-filter': [{
        action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }]
      }],
      'meta-data': [{
        $: {
          'android:name': 'android.accessibilityservice',
          'android:resource': '@xml/accessibility_service_config'
        }
      }]
    });

    // Fake Power Menu Overlay Service
    application.service.push({
      $: {
        'android:name': 'com.rajkumar.thunai.stealthmode.FakePowerMenuService',
        'android:exported': 'false'
      }
    });

    return config;
  });
};
