# Agent isolation

How agents point, click, type and switch tabs without ever touching the
user's own cursor, focus, window or view, and without getting in each
other's way. An agent works its tabs in the background, several agents work
several tabs at once, and the user keeps using the same browser, or works on
a tab together with an agent.

## Between the user and every agent

1. **The window is never raised, so the OS pointer never moves.** A
   system-privileged `window.focus()` in a page asks the parent to raise the
   browser window (`nsGlobalWindowOuter::FocusOuter` → `RaiseWindow` →
   `BrowserParent::RecvRequestFocus` → `FLAG_RAISE`). Window managers that
   warp the pointer to a raised window then move the user's cursor with it.
   This is what moved the cursor across monitors while the virtual cursor
   (`PointerPad`) worked. Agent-driven label sessions and pads
   (`agentDriven`) never repair focus: their keys reach them by message
   (`Zendia:FeedToken`), so they need no focus. The user's own sessions keep
   repairing focus as before, because the user is in that window anyway.
2. **The user's view is never switched.** Agents never bring a tab
   forward unless `zendia.agent.stealFocus` is on: `tab_open` and
   `tab_switch` work in the background even while the user looks at the
   agent's tab, and the CAPTCHA subagent selects nothing. A page an agent
   drives can't take the view either (`ZendiaAgents.#guardWindow`). The
   agent's clicks count as user input to the page, so the page may open a
   pop-up or focus one, and Zen would select that tab, across workspaces,
   and focus the window (`on_framefocusrequested`). Its pop-ups open in the
   background (`gBrowser.addTab` with `inBackground`), where they become
   the agent's tabs. Its focus requests are dropped unless its tab is the
   one in front, in the window the user is in.
3. **The user's focus is never taken.** All agent input is synthesized in
   the page; nothing native is sent. While the user's focus is in this
   window's own UI (the address bar, the chat), `page_act` runs `quiet`:
   text fields are filled without focusing them (`setUserInput`), keys go
   to their element instead of through the text input processor, and agent
   mouse presses (`ZendiaDom.agentMouse`) have their mousedown default
   prevented after the page has heard it, so Gecko moves no focus.
4. **The user's keys are their own.** The keys actor keeps two slots:
   `#capture` (the user's labels) and `#agentCapture` (an agent's). The
   user's keys never reach an agent's labels, and an agent's tokens never
   reach the user's labels or the keymap. If the user starts labels of
   their own, or presses `Esc`, the agent's labels come off, and the parent
   hears `Zendia:AgentCaptureDismissed`. The CAPTCHA subagent then stops
   and says so in the chat. An agent cannot start labels over the user's
   (`startCapture` returns false).
5. **The user comes first in a shared tab.** Every frame reports the user's
   own key, pointer and wheel input (`Zendia:UserInput`; synthesized input
   is told apart by `event.isSynthesized`). Before acting, an agent waits
   until that input has paused for 1.5 s. If the user keeps going for 8 s,
   nothing is done and the agent is told to wait or work elsewhere.

## Between agents

- **One driver per tab** (`ZendiaAgents.claim`). The agent that last acted
  on a tab drives it while its turn runs, and so does a tab's own chat
  while it works that tab. Another agent may still read that tab, but
  `page_act`, `page_navigate`, `browser_action`, `tab_switch` and
  `tab_close` are refused with who has it. The tab is free once that turn
  ends.
- **Separate input.** Each agent's labels, keys and CAPTCHA work are tied
  to its own tab and session. `ZendiaDom.agentTyping` is shared per content
  process, but it is only ever set and cleared within one synchronous
  dispatch, so two agents cannot interleave on it.
- **Several tabs at once.** Every page tool takes `tab`, so an agent works
  any of its tabs without switching to it.

## Background operation

- Tabs an agent controls stay awake while the user is on another tab. A
  hidden page gets no animation frames, its timers wait a second at least,
  and it reads as hidden. Single-page apps that step on only after a frame,
  or once shown (a form's Submit), stood still under the agent's clicks.
  For the length of its turn, every tab the agent controls gets Zen's own
  keep-awake flag (`zenModeActive`, the one Glance uses), which keeps the
  docshell active and rendering. The tab switcher does not put it to sleep
  and the unloader does not discard it. It sleeps again when the turn ends,
  unless it is in view. "In view" for keeping the user's focus (`quiet`)
  is therefore the selected or split-view tab, not merely an active one.
- Acts in background tabs are as fast as in front: the agent's settle
  waits use `Timer.sys.mjs` timers, not the page's, which Firefox throttles
  to one second in background tabs.
- Screenshots work in background tabs: where the browser element is not
  laid out, the view's size is asked of the content (`Zendia:ViewSize`).
- The CAPTCHA subagent labels, photographs and works a challenge in the
  background. Some widgets (hCaptcha's) do not load in a tab that has never
  been shown. The subagent then tells the user to switch to the tab rather
  than switching it for them.

## Marks

Every tab an agent controls during a turn is marked, not only the one it
works on now. That covers its own tab, tabs it acted on by `tab` id, tabs it
switched away from, tabs it opened, and tabs its pages opened (a link with a
target, a `window.open`). Each such tab gets:

- the glow in the agent's color over the page;
- a badge of the agent's logo over the tab's icon in the tab strip, with a
  ring in its color rippling out from it while the agent works (still under
  reduced motion);
- the agent's chat in the panel. A tab with an empty chat of its own (the
  panel started one when the user looked at it) switches to the agent's
  chat, including while the panel is open on it. A chat with anything in it
  stays the tab's.

All of it goes away when that agent's turn ends (`setDriving(false)`). A
tab another agent has lit since stays lit.

Each agent's other marks are drawn in its own color, `agentColor(id)`: a ghost
cursor flashes at every click, fill, select and press of `page_act`
(`flashPointer`), and its virtual cursor and prompt dot carry the color.
Letter tags keep the standard hint color, so they stay readable on the
CAPTCHA subagent's screenshots.

## Tests

The tests are a Marionette script against the built browser, with
`focusmanager.testmode` off, since test mode fakes window raises in the
content process. They cover:

- raises and focus requests, with a control that reproduces the raise
- address-bar focus while an agent works the visible tab
- background acts and their timing
- follow
- claims between two agents
- waiting for the user
- the capture slots
- the CAPTCHA board fixture and the hCaptcha demo in the background
- two agents plus a CAPTCHA session at once while the user works in
  another window
- the user's own label keys
