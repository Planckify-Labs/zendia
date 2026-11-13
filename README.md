<!--
   - This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/.
   -->

### `Zendia`

Zendia is a Firefox-based browser for people who live in Neovim and work with coding agents.

- **Vim mode.** Drive tabs, pages, splits and the sidebar with Neovim's keys. It is on by default, and you can turn it off in the onboarding or from the app menu.
- **Your own agent.** Ask Claude Code, Codex, Cursor, Antigravity, OpenCode or Kiro about the current tab, and let them work in the browser through a built-in MCP server. Zendia finds the agents you already have installed.
- **uBlock Origin built in.** Ad blocking works from the first launch.

### Built on Zen

Zendia is built on the stable branch of [Zen Browser](https://github.com/zen-browser/desktop) and keeps up with its releases. Zen's spaces, split view, compact mode, Library and Zen Mods all work in Zendia. Thanks to the Zen team and to its [sponsors](https://zen-browser.app/#sponsors).

### Building

```sh
npm ci
npm run init     # download Firefox's source, apply the patches, bootstrap
npm run build
npm run dev      # run with the .dev-profile profile
```

Tests run from `engine/`, for example `./mach test zen/tests/zendia/xpcshell.toml`.

### Contributing

Report bugs and ask for features on [GitHub Issues](https://github.com/Planckify-Labs/zendia/issues). Report a bug in Zen itself to [Zen](https://github.com/zen-browser/desktop/issues).

### License

Zendia, like Zen and Firefox, is licensed under the [Mozilla Public License 2.0](./LICENSE).
