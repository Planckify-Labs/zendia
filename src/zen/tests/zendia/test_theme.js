/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ZendiaTheme, ZENDIA_PALETTE } = ChromeUtils.importESModule(
  "resource:///modules/zendia/ui/ZendiaTheme.sys.mjs"
);

const PREF = "zendia.theme";

add_task(function test_roles_point_at_the_palette() {
  Services.prefs.clearUserPref(PREF);
  Assert.equal(ZendiaTheme.hex("mode-n"), ZENDIA_PALETTE.pink.dark);
  Assert.equal(ZendiaTheme.hex("accent", "light"), ZENDIA_PALETTE.pink.light);
  Assert.equal(
    ZendiaTheme.hex("agent-user"),
    ZENDIA_PALETTE.pink.dark,
    "a role can point at another role"
  );
  const variables = ZendiaTheme.variables();
  Assert.equal(
    variables["--zendia-md-link"],
    `light-dark(${ZENDIA_PALETTE.blue.light}, ${ZENDIA_PALETTE.blue.dark})`,
    "each variable follows Zen's light and dark themes"
  );
  Assert.equal(variables["--zendia-ink"], "#1b1d2b");
  Assert.equal(variables["--zendia-glass-opacity"], "78%");
});

add_task(function test_the_pref_overrides_it() {
  Services.prefs.setStringPref(
    PREF,
    JSON.stringify({
      palette: { pink: "#ff79c6" },
      roles: {
        "md-strong": "teal",
        "md-link": { light: "#111111", dark: "#eeeeee" },
        "md-h1": "not a color",
      },
      glass: { opacity: 0.5, blur: 12 },
      agents: { claude: "#123456" },
    })
  );
  registerCleanupFunction(() => Services.prefs.clearUserPref(PREF));
  Assert.equal(ZendiaTheme.hex("accent"), "#ff79c6", "through the role");
  Assert.equal(ZendiaTheme.hex("md-strong"), ZENDIA_PALETTE.teal.dark);
  Assert.equal(ZendiaTheme.hex("md-link", "light"), "#111111");
  Assert.equal(
    ZendiaTheme.hex("md-h1"),
    ZENDIA_PALETTE.blue.dark,
    "what is not a color keeps the default"
  );
  Assert.equal(ZendiaTheme.agentColor("claude"), "#123456");
  const variables = ZendiaTheme.variables();
  Assert.equal(variables["--zendia-glass-opacity"], "50%");
  Assert.equal(variables["--zendia-glass-blur"], "12px");

  Services.prefs.setStringPref(PREF, "{not json");
  Assert.equal(
    ZendiaTheme.hex("accent"),
    ZENDIA_PALETTE.pink.dark,
    "a broken pref falls back to the defaults"
  );
});
