// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaKeys } from "resource:///modules/zendia/core/ZendiaKeys.sys.mjs";

export const ZendiaOptions = {
  PREF_ENABLED: "zendia.enabled",
  PREF_LEADER: "zendia.leader",
  PREF_TIMEOUTLEN: "zendia.timeoutlen",
  PREF_STATUSLINE: "zendia.statusline.enabled",

  get enabled() {
    return Services.prefs.getBoolPref(this.PREF_ENABLED, true);
  },

  get leader() {
    const leader = Services.prefs.getStringPref(
      this.PREF_LEADER,
      ZendiaKeys.DEFAULT_LEADER
    );
    try {
      ZendiaKeys.parse(leader, { leader });
      return leader;
    } catch (e) {
      console.error(`Zendia: invalid ${this.PREF_LEADER} "${leader}"`, e);
      return ZendiaKeys.DEFAULT_LEADER;
    }
  },

  get timeoutlen() {
    return Math.max(0, Services.prefs.getIntPref(this.PREF_TIMEOUTLEN, 300));
  },

  get statusline() {
    return Services.prefs.getBoolPref(this.PREF_STATUSLINE, true);
  },
};
