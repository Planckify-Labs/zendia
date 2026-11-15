// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";

// In the browser this page is a frame of the browser window, which holds the
// host for it; the dev page defines its own.
const host = window.zendiaWelcomeHost ?? window.parent.zendiaWelcomeHost;
document.documentElement.dataset.theme = host.dark ? "dark" : "light";
createRoot(document.getElementById("root")).render(<App host={host} dev={host.dev} />);
