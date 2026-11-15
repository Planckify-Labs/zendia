# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## The onboarding. It opens on a start page, then goes through six chapters,
## each a page with a preview of what it is about and the choices to make.

# The browser's name as the onboarding says it. It is not the build's brand
# name: a local build is branded "Nightly" and the Twilight channel
# "Twilight", and the onboarding introduces Zendia in all of them.
-zendia-name = Zendia
zendia-welcome-brand = { -zendia-name }

zendia-welcome-start-title = Hands on the keys.
zendia-welcome-start-description = { -zendia-name } is a browser you drive from the keyboard, with your own agent along for the ride and the ads left outside.
zendia-welcome-start = Set up { -zendia-name }

zendia-welcome-next = Next
zendia-welcome-back = Back
zendia-welcome-skip = Skip
zendia-welcome-finish = Start browsing

# The names of the keys that move through the onboarding, shown on its
# buttons.
zendia-welcome-key-enter = Enter
zendia-welcome-key-backspace = Backspace

## The chapters' short names, in the row along the top.

zendia-welcome-chapter-keys = Keys
zendia-welcome-chapter-agent = Agent
zendia-welcome-chapter-shield = Shield
zendia-welcome-chapter-move-in = Move in
zendia-welcome-chapter-apps = Apps
zendia-welcome-chapter-go = Go

## Keys: vim mode.

zendia-welcome-keys-title = Drive it like Neovim.
zendia-welcome-keys-description = Vim mode gives every key a job, for people who already think in modes. Not your thing? Turn it off here, or any time with the vim mode switch in the menu.
zendia-welcome-keys-yes = <strong>YES</strong>, turn on vim mode.
zendia-welcome-keys-no = <strong>NO</strong>, keep the usual shortcuts.
zendia-welcome-key-scroll = Scroll the page
zendia-welcome-key-next-tab = Next and previous tab
zendia-welcome-key-leader = Every other command
zendia-welcome-key-explorer = Move around the sidebar
zendia-welcome-key-agent = Ask your agent about the tab
zendia-welcome-key-escape = Leave a text field

## Agent: the coding agent that works on the tab.

zendia-welcome-agent-title = Bring your own agent.
zendia-welcome-agent-description = Press Space A A on any tab and ask the coding agent you already use, signed in as you. It reads the page, clicks, types and navigates for you, and asks before it closes anything.
zendia-welcome-agent-looking = Looking for agents on this computer…
zendia-welcome-agent-none = No agent found yet. Install one, then press Space A S to pick it.
zendia-welcome-agent-missing = Not installed

## Shield: ad blocking.

zendia-welcome-shield-title = Leave the ads outside.
zendia-welcome-shield-description = { -zendia-name } comes with uBlock Origin, so pages load cleaner and faster. You can remove it any time.
zendia-welcome-shield-yes = <strong>YES</strong>, keep blocking ads.
zendia-welcome-shield-no = <strong>NO</strong>, show me everything.

## Move in: what to bring from another browser, where searches go, and
## whether links from other apps open here.

zendia-welcome-move-in-title = Move in.
zendia-welcome-move-in-description = Bring your bookmarks, history and passwords, pick where your searches go, and say whether links from other apps open here.
zendia-welcome-import-heading = Bring from
zendia-welcome-import-none = Nothing, start fresh
zendia-welcome-search-heading = Search with
zendia-welcome-default-heading = Links from other apps
zendia-welcome-default-yes = Open in { -zendia-name }
zendia-welcome-default-no = Leave as they are

## Apps: sites to pin at the top of the sidebar.

zendia-welcome-apps-title = Pin what you open every day.
zendia-welcome-apps-description = The ones you pick stay at the top of the sidebar, a key away. You can add or drop them later.

## Go: the last page.

zendia-welcome-go-title = You are set.
zendia-welcome-go-description = Everything you chose here can be changed later. Go and browse.
zendia-welcome-go-vim-hint = Press Space, then ?, to see every key.
