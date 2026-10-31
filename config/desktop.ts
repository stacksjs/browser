import type { DesktopConfig } from '@stacksjs/types'

/**
 * Browser on the Mac: the stx screens in resources/native drawn by Craft's
 * AppKit host, with web pages in WebKit views (`webkit`), and this project's
 * API running inside the app (`agent`) for history, imports and settings.
 *
 * `bun run dev:desktop` builds the screens and opens the app;
 * `bun run build:desktop` builds a signed `.app` in storage/framework/desktop/macos.
 */
export default {
  macos: {
    appName: 'Browser',
    bundleId: 'com.stacksjs.browser',
    category: 'public.app-category.productivity',
    agent: true,
    webkit: true,
    defaultBrowser: true,
    permissions: {
      network: true,
      camera: 'Websites you allow can use your camera.',
      microphone: 'Websites you allow can use your microphone.',
      location: 'Websites you allow can see your approximate location.',
      downloads: true,
      printing: true,
    },
    dockMenu: [
      { title: 'New Tab', action: 'new-tab' },
      { title: 'New Private Window', action: 'new-private-window' },
    ],
    nativeScreens: ['Main'],
    window: { width: 1280, height: 820, minWidth: 900, minHeight: 560, titlebarStyle: 'transparent', trafficLights: [18, 15] },
  },
} satisfies DesktopConfig
