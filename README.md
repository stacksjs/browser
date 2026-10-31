# Browser

A fast, native Mac browser in the spirit of Arc, built on [Stacks](https://stacksjs.com),
[stx](https://github.com/stacksjs/stx) and [Craft](https://github.com/craft-native/craft).
"Browser" is a working name.

- **Native UI.** The sidebar, toolbar and command bar are stx screens drawn as AppKit views by
  Craft's macOS host, with zig-js running the screen logic. The browser's own interface is not a web page.
- **WebKit pages.** Each tab is a `WKWebView`, shown with `<WebView tab="...">` and driven through
  `craft.web`. Each profile keeps its own cookies and storage; private tabs keep nothing.
- **An API inside the app.** `config/desktop.ts` turns on `agent`, so this project's routes run on
  127.0.0.1 while the app is open, reachable only from its own window.

## Running it

```bash
bun run dev:desktop
```

builds the screens and the AppKit host, then opens the app. `bun run build:desktop` builds a
signed `.app` in `storage/framework/desktop/macos`.

While a needed Craft or stx release is still on its way to npm, point the build at a checkout:
`CRAFT_MACOS_SRC=<craft>/packages/macos/src/index.ts` and
`STX_NATIVE_SRC=<stx>/packages/stx/src/native/index.ts`.

## Testing

```bash
bun test tests/unit/browser
./buddy lint
./buddy typecheck
```

The sidebar, tab and command-bar logic lives in `resources/functions/browser` as plain functions
with unit tests, so most behaviour is tested without a window. For the window itself, Craft's host
takes `--test-dir <dir>`: it records the real AppKit view tree in `state.json` and runs
`action-<n>.json` files (`command`, `press`, `type`, `submit`, `key`, `hover`, `appearance`,
`screenshot`).

## How it is put together

| Path | What it holds |
|---|---|
| `config/desktop.ts` | The Mac app: name, bundle id, WebKit, default-browser registration, permissions, Dock menu, its three screens |
| `resources/native/Main.stx` | The main window: sidebar, content (one page or a split view), command bar, Library, site controls, find, downloads, Peek, Boosts, onboarding |
| `resources/native/Little.stx` | The small floating window links from other apps open in; Open in Browser hands the live page to the main window |
| `resources/native/Settings.stx` | Settings (cmd-,), kept in `craft.storage` and posted to open windows |
| `resources/functions/browser/sidebar.ts` | Spaces, Favorites, Pinned tabs and folders, Today, split views of up to four tabs; every change returns a new state |
| `resources/functions/browser/menus.ts` | What right-clicking a row or a space offers, and what each choice does (profiles included) |
| `resources/functions/browser/theme.ts` | A space's light and dark palettes from one to three colours, with readable text |
| `resources/functions/browser/order.ts` | Sort keys, so a drag rewrites one row |
| `resources/functions/browser/pages.ts` | Which tabs have a live page: created on first show, released when they sleep |
| `resources/functions/browser/hibernation.ts` | When an unseen tab gives its page up |
| `resources/functions/browser/rank.ts`, `actions.ts`, `suggestions.ts` | Command-bar results: tabs, history, actions and search suggestions, by match quality and frecency |
| `resources/functions/browser/keymap.ts` | Arc's keyboard shortcuts, as menus |
| `resources/functions/browser/library.ts` | The Library's archive, history and downloads, grouped by day |
| `resources/functions/browser/sites.ts` | Per-site settings: the blocker, zoom, camera and microphone answers |
| `resources/functions/browser/blocker.ts` | very-good-adblock's lists and page scripts handed to WebKit, compiled only when they change |
| `resources/functions/browser/boosts.ts` | A site's own CSS, JS and zapped elements |
| `resources/functions/browser/peek.ts` | Which links open over the page instead of as a tab |
| `resources/functions/browser/settings.ts` | The browser's settings and their defaults |
| `resources/functions/browser/arc-import.ts`, `onboarding.ts` | Arc's sidebar as this browser's, merged into what is there, and the first-launch steps |
| `resources/functions/browser/history-client.ts`, `session.ts` | Visits and sidebar changes sent to the agent in batches, and flushed on quit |
| `app/Desktop/Agent.ts` | Routes only the desktop app serves: history, session, archive, downloads, sites, boosts, suggestions, blocker, Arc import |
| `app/Desktop/database.ts` | Opens `~/Library/Application Support/Browser/Browser.sqlite` with every model, so one schema covers the file |
| `app/Desktop/*.ts` | One store and its API per table, plus `arc.ts` (reads copies of Arc's files) and `suggest.ts` (the search engine's suggestions) |
| `app/Models/` | `HistoryEntry`, `Space`, `SidebarItem`, `SessionValue`, `Download`, `SiteSetting`, `Boost` |

The Arc importer only ever reads a copy of Arc's files; it never writes them.

## Performance

`tests/perf/budgets.test.ts` holds the code to the plan's budgets. Measured on an Apple Silicon Mac
(Oct 31, 2026), medians:

| What | Budget | Measured |
|---|---|---|
| Draw a 500-row sidebar (both sections and the tab order) | < 8 ms | 0.22 ms |
| Reorder a row and work out what to save | < 8 ms | 0.05 ms |
| Rank 5,000 tabs and pages for the command bar | < 10 ms | 2.5 ms |
| Search 20,000 history pages (first results) | < 50 ms | 2.6 ms |
| Launch to the sidebar drawn | < 250 ms | about 1.8 s |
| Host and agent memory, idle | < 120 MB | about 525 MB and 187 MB |

The last two miss, and neither is the app's code: almost all of the launch time and the host's
memory go to zig-js loading the screen bundle (a one-screen bundle takes 0.7 s and 205 MB), and
about 360 KB of every bundle is stx's whole web page runtime, which a native screen mostly does
not use. Both are being fixed where they live, in zig-js and in stx's native compiler.
