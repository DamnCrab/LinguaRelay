import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  srcDir: 'src',
  manifestVersion: 3,
  manifest: {
    name: 'LinguaRelay Live Translator',
    short_name: 'LinguaRelay',
    description:
      'Real-time transcription and translation overlay for YouTube live streams.',
    permissions: ['storage', 'tabs'],
    host_permissions: ['*://*.youtube.com/*', 'https://*/*', 'http://*/*'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: {
      default_title: 'LinguaRelay',
      default_popup: 'popup.html',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    browser_specific_settings: {
      gecko: {
        id: 'linguarelay@example.com',
        strict_min_version: '121.0',
      },
    },
  },
  webExt: {
    startUrls: ['https://www.youtube.com/watch?v=jfKfPfyJRdk'],
  },
});

