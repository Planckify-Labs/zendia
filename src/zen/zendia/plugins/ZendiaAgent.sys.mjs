// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The user's own agent on the current tab, under LazyVim's <leader>a "ai"
// group, after sidekick.nvim: <leader>aa asks, <leader>as picks the agent.
// The dock is per window; the page tools are content actions the agent's
// MCP tools call, never mapped to keys.

const CONTENT = "resource:///modules/zendia/plugins/ZendiaAgentContent.sys.mjs";

function dock({ zendia, window }) {
  return zendia.agentDockFor(window);
}

export const ZendiaAgentSpec = {
  name: "agent",
  actions: {
    "agent.ask": {
      desc: "Ask Agent About This Tab",
      agent: false,
      run: context => dock(context)?.open(context.browser),
    },
    "agent.toggle": {
      desc: "Toggle Agent",
      agent: false,
      run: context => dock(context)?.toggle(context.browser),
    },
    "agent.list": {
      desc: "Toggle Agents Panel",
      agent: false,
      run: ({ zendia, window }) => zendia.agentsPanelFor(window)?.toggle(),
    },
    "agent.select": {
      desc: "Select Agent",
      agent: false,
      run: context => dock(context)?.pickAgent(),
    },
    "agent.model": {
      desc: "Select Agent Model",
      agent: false,
      run: context => dock(context)?.pickModel(),
    },
    "agent.stop": {
      desc: "Stop Agent",
      agent: false,
      run: context => dock(context)?.stop(),
    },
    "agent.new": {
      desc: "New Agent Conversation",
      agent: false,
      run: context => dock(context)?.reset(context.browser),
    },
    "agent.log": {
      desc: "Open Agent Log",
      agent: false,
      run: context => dock(context)?.openLog(context.browser),
    },
    "agent.observe": {
      desc: "Read the Page for the Agent",
      where: "content",
      module: CONTENT,
      params: { scope: "string?", outline: "boolean?", a11y: "boolean?" },
      agent: false,
    },
    "agent.extract": {
      desc: "Read a Table or List for the Agent",
      where: "content",
      module: CONTENT,
      params: { id: "string", offset: "number?", limit: "number?" },
      agent: false,
    },
    "agent.fetch": {
      desc: "Fetch an Address as the Page for the Agent",
      where: "content",
      module: CONTENT,
      params: {
        url: "string",
        method: "string?",
        headers: "object?",
        body: "string?",
      },
      agent: false,
    },
    "agent.version": {
      desc: "Ask How Much the Page Has Changed",
      where: "content",
      module: CONTENT,
      agent: false,
    },
    "agent.act": {
      desc: "Act on the Page for the Agent",
      where: "content",
      module: CONTENT,
      // agentColor: the driving agent's own color, which the click and
      // press points are marked with (flashPointer). quiet: the user's
      // focus is in the window's own UI, and stays there.
      params: {
        action: "string",
        element: "string?",
        text: "string?",
        agentColor: "string?",
        quiet: "boolean?",
      },
      agent: false,
    },
  },
};
