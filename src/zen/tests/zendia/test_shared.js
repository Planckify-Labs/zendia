/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ZendiaActions } = ChromeUtils.importESModule(
  "resource:///modules/zendia/core/ZendiaActions.sys.mjs"
);
const { ZendiaKeymap } = ChromeUtils.importESModule(
  "resource:///modules/zendia/core/ZendiaKeymap.sys.mjs"
);
const { ZendiaPlugins } = ChromeUtils.importESModule(
  "resource:///modules/zendia/core/ZendiaPlugins.sys.mjs"
);
const { serializeConfig, buildKeymap } = ChromeUtils.importESModule(
  "resource:///modules/zendia/core/ZendiaShared.sys.mjs"
);

add_task(function test_round_trip() {
  const actions = new ZendiaActions();
  const keymap = new ZendiaKeymap({ leader: "," });
  const plugins = new ZendiaPlugins({ actions, keymap });
  plugins.load({
    specs: [
      {
        name: "scroll",
        opts: { step: 60, callback: () => {} },
        actions: {
          "scroll.down": {
            desc: "Scroll Down",
            where: "content",
            module: "resource:///modules/example.sys.mjs",
            params: { count: "number?" },
          },
        },
        keys: [["n", "j", "scroll.down"]],
        groups: [["n", "<leader>b", "buffer"]],
      },
    ],
  });
  keymap.set("n", "Q", () => {});

  const config = structuredClone(
    serializeConfig({ version: 3, timeoutlen: 500, keymap, actions, plugins })
  );
  Assert.equal(config.version, 3);
  Assert.equal(config.timeoutlen, 500);
  Assert.equal(config.leader, ",");
  Assert.deepEqual(config.actions["scroll.down"], {
    where: "content",
    module: "resource:///modules/example.sys.mjs",
    params: { count: "number?" },
    owner: "scroll",
  });
  Assert.deepEqual(
    config.options.scroll,
    { step: 60 },
    "options are reduced to what can cross processes"
  );
  Assert.ok(
    !config.mappings.some(m => m.lhs == "Q"),
    "function mappings stay in the parent"
  );

  const rebuilt = buildKeymap(config);
  Assert.equal(rebuilt.get("n", "j").rhs, "scroll.down");
  Assert.equal(rebuilt.get("n", "j").desc, "Scroll Down");
  Assert.equal(rebuilt.groupName("n", [",", "b"]), "buffer");
});
