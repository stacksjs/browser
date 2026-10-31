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
| `config/desktop.ts` | The Mac app: name, bundle id, WebKit, default-browser registration, permissions |
| `resources/native/Main.stx` | The main window: sidebar, content card, command bar |
| `resources/functions/browser/sidebar.ts` | Spaces, Favorites, Pinned tabs and folders, Today; every change returns a new state |
| `resources/functions/browser/order.ts` | Sort keys, so a drag rewrites one row |
| `resources/functions/browser/pages.ts` | Which tabs have a live page: created on first show, released when they sleep |
| `resources/functions/browser/hibernation.ts` | When an unseen tab gives its page up |
| `resources/functions/browser/rank.ts` | Command-bar results: match quality plus frecency |
| `resources/functions/browser/keymap.ts` | Arc's keyboard shortcuts, as menus |
| `resources/functions/browser/arc-import.ts` | Spaces, pinned tabs, folders and favorites from Arc's `StorableSidebar.json` |
| `resources/functions/browser/history-client.ts` | Turns finished page loads into visits, sent to the agent a second at a time |
| `app/Desktop/Agent.ts` | Routes only the desktop app serves: `/api/history` |
| `app/Desktop/history.ts` | History in `~/Library/Application Support/Browser/Browser.sqlite`: one row per page, a trigram search index, frecency |
| `app/Models/HistoryEntry.ts` | The history table, migrated from the model when the app opens |

The Arc importer only ever reads a copy of Arc's files; it never writes them.
