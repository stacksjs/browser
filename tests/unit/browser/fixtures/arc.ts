/** A small `StorableSidebar.json` in Arc's own shape, for the importer's tests. */
// Arc's shape: alternating id/value lists, enum cases as keys, Cocoa reference dates.
const cocoa = (unixMs: number) => unixMs / 1000 - 978_307_200
const color = (red: number, green: number, blue: number, alpha = 1) => ({ red, green, blue, alpha, colorSpace: 'extendedSRGB' })
const item = (id: string, data: object, extra: object = {}) => [id, { id, data, childrenIds: [], parentID: null, title: null, createdAt: cocoa(1_700_000_000_000), ...extra }]
export const arcFixture = {
  sidebar: { containers: [{ global: {} }, {
    spaces: ['sp1', {
      id: 'sp1', title: 'Personal', profile: { default: true },
      customInfo: { iconType: { icon: 'star' }, windowTheme: { semanticColorPalette: { appearanceBased: {
        light: { cutoutColor: color(0.8, 0.82, 0.99), maxContrastColor: color(0.1, 0.1, 0.4), title: color(0.05, 0.05, 0.2), hover: color(1, 1, 1, 0.4), backgroundExtra: color(1, 1, 1, 0.8) },
        dark: { cutoutColor: color(0.15, 0.15, 0.35), maxContrastColor: color(0.9, 0.9, 1), title: color(0.95, 0.95, 1), hover: color(1, 1, 1, 0.1), backgroundExtra: color(1, 1, 1, 0.18) },
      } } } },
      containerIDs: ['unpinned', 'c-today', 'pinned', 'c-pinned'],
    }],
    items: [
      ...item('c-pinned', { itemContainer: { containerType: { spaceItems: { _0: 'sp1' } } } }, { childrenIds: ['folder', 'mail', 'split'] }),
      ...item('folder', { list: {} }, { title: 'Work', childrenIds: ['jira', 'easel'] }),
      ...item('jira', { tab: { savedURL: 'https://jira.example', savedTitle: 'Jira', customInfo: { iconType: { emoji_v2: '🧭' } } } }),
      ...item('easel', { easel: {} }),
      ...item('mail', { tab: { savedURL: 'https://mail.example', savedTitle: 'Mail' } }, { title: 'My Mail' }),
      ...item('split', { splitView: { layoutOrientation: 'horizontal' } }, { childrenIds: ['left', 'right'] }),
      ...item('left', { tab: { savedURL: 'https://left.example' } }),
      ...item('right', { tab: { savedURL: 'https://right.example' } }),
      ...item('c-today', { itemContainer: { containerType: { spaceItems: { _0: 'sp1' } } } }, { childrenIds: ['news', 'doc', 'broken'] }),
      ...item('news', { tab: { savedURL: 'https://news.example', savedTitle: 'News', timeLastActiveAt: cocoa(1_710_000_000_000) } }),
      ...item('doc', { arcDocument: {} }),
      ...item('broken', { tab: { savedTitle: 'No address' } }),
      ...item('c-top', { itemContainer: { containerType: { topApps: { _0: { default: true } } } } }, { childrenIds: ['cal'] }),
      ...item('cal', { tab: { savedURL: 'https://cal.example', savedTitle: 'Calendar' } }),
    ],
    topAppsContainerIDs: [{ default: true }, 'c-top'],
  }] },
}
