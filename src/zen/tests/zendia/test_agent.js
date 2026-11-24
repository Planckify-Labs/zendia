/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  ZENDIA_AGENTS,
  candidatesIn,
  expand,
  isWindowsAbsolute,
  newestCursorVersion,
  parseBatchShim,
  parseManagerDir,
  parseShellPath,
  parseVersion,
  parseWindowsPath,
  pathEnvironment,
  runForOutput,
  stampOf,
  ZendiaAgentDetect,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgentDetect.sys.mjs"
);
const {
  ZENDIA_DRIVERS,
  ZendiaAgentRun,
  guessInputs,
  holdsJSON,
  orderEfforts,
  parseClaudeModels,
  STDIO_PROXY,
  TOKEN_ENV,
  URL_ENV,
  WINDOWS_STDIO_PROXY,
  stdioProxyCommand,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgentHarness.sys.mjs"
);
const { ZendiaAgents, PREF_CONTEXT, PREF_EFFORT } = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs"
);
const { ZendiaAgentServer, handleMcpMessage } = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgentServer.sys.mjs"
);
const { ZendiaPictureToolbox, fitResult, formatObservation, normalizeCall } =
  ChromeUtils.importESModule(
    "resource:///modules/zendia/agent/ZendiaAgentTools.sys.mjs"
  );
const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs"
);
const { ZendiaAgentLog, summarize } = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgentLog.sys.mjs"
);
const { TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/TestUtils.sys.mjs"
);

do_get_profile();
registerCleanupFunction(() => ZendiaAgentServer.stop());

const TURN = {
  prompt: "Open the docs",
  resume: null,
  first: true,
  mcp: { url: "http://127.0.0.1:1234/mcp", token: "secret" },
  dir: "/tmp/agent",
  runId: "r1",
};

function parseAll(id, lines) {
  return lines.flatMap(line => ZENDIA_DRIVERS[id].parse(line));
}

// A session answering like ZendiaAgentToolbox, with fixed tools.
function fakeSession(calls = []) {
  return {
    listTools: () => [
      { name: "page_observe", inputSchema: { type: "object" } },
    ],
    async callTool(name, args) {
      calls.push({ name, args });
      if (name == "fail") {
        throw new Error("no page");
      }
      return { text: `observed ${JSON.stringify(args)}` };
    },
  };
}

function post(url, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

add_task(function test_known_agents() {
  Assert.deepEqual(
    ZENDIA_AGENTS.map(agent => agent.id),
    ["claude", "codex", "cursor", "antigravity", "opencode", "kiro"]
  );
  for (const agent of ZENDIA_AGENTS) {
    ok(!!ZENDIA_DRIVERS[agent.id], `${agent.id} has a driver`);
  }
});

add_task(function test_shell_snapshot_parsing() {
  const output =
    "motd noise\n__ZENDIA_SHELL_ENV_BEGIN__\nHOME=/home/u\nPATH=/home/u/.nvm/bin:/usr/bin\n__ZENDIA_SHELL_ENV_END__\n";
  Assert.equal(parseShellPath(output), "/home/u/.nvm/bin:/usr/bin");
  Assert.equal(parseShellPath("PATH=/usr/bin"), null, "needs the markers");
  Assert.equal(parseVersion("2.1.312 (Claude Code)"), "2.1.312");
  Assert.equal(parseVersion("codex-cli 0.159.1"), "0.159.1");
  Assert.equal(parseVersion("no version"), null);
});

add_task(function test_windows_path_handling() {
  const vars = {
    USERPROFILE: "C:\\Users\\u",
    LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
  };
  const getenv = name => vars[name] ?? null;
  Assert.equal(
    expand("%LOCALAPPDATA%\\agy\\bin", getenv),
    "C:\\Users\\u\\AppData\\Local\\agy\\bin"
  );
  Assert.equal(expand("%NOT_SET%\\bin", getenv), null, "unset variable");
  Assert.equal(expand("/usr/local/100%/x", getenv), "/usr/local/100%/x");

  // What the registry holds: unexpanded variables, quotes, blanks, junk.
  const dirs = parseWindowsPath(
    '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links;"C:\\Program Files\\nodejs\\";;relative\\bin;%GONE%\\x;C:\\Windows\\System32',
    getenv
  );
  Assert.deepEqual(dirs, [
    "C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links",
    "C:\\Program Files\\nodejs\\",
    "C:\\Windows\\System32",
  ]);
  ok(isWindowsAbsolute("D:/tools"), "drive with a slash");
  ok(isWindowsAbsolute("\\\\server\\share"), "UNC share");
  ok(!isWindowsAbsolute("/usr/bin"), "POSIX path");

  const names = candidatesIn("C:\\bin", "claude", true).map(path =>
    path.slice(path.lastIndexOf("claude"))
  );
  Assert.deepEqual(
    names,
    ["claude.exe", "claude.cmd", "claude.bat"],
    "a real executable before an npm shim"
  );
  Assert.deepEqual(candidatesIn("/bin", "claude", false), ["/bin/claude"]);

  // The shims npm (cmd-shim 7) and pnpm write, read for what they start.
  Assert.deepEqual(
    parseBatchShim(
      [
        "@ECHO off",
        "GOTO start",
        ":find_dp0",
        "SET dp0=%~dp0",
        "EXIT /b",
        ":start",
        "SETLOCAL",
        "CALL :find_dp0",
        "",
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ") ELSE (",
        '  SET "_prog=node"',
        "  SET PATHEXT=%PATHEXT:;.JS;=;%",
        ")",
        "",
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
      ].join("\r\n")
    ),
    [["%_prog%", "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js"]],
    "npm's shim runs %_prog% on the script"
  );
  Assert.deepEqual(
    parseBatchShim(
      [
        '@IF EXIST "%~dp0\\node.exe" (',
        '  "%~dp0\\node.exe"  "%~dp0\\..\\pkg\\cli.js" %*',
        ") ELSE (",
        "  @SETLOCAL",
        "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
        '  node  "%~dp0\\..\\pkg\\cli.js" %*',
        ")",
      ].join("\r\n")
    ),
    [
      ["%~dp0\\node.exe", "%~dp0\\..\\pkg\\cli.js"],
      ["node", "%~dp0\\..\\pkg\\cli.js"],
    ],
    "pnpm's shim: node.exe beside it, then node from PATH"
  );
  Assert.deepEqual(parseBatchShim("@echo off\r\nset X=1\r\n"), []);

  // Every agent says where its Windows installer puts it and how to run it.
  for (const agent of ZENDIA_AGENTS) {
    ok(agent.winDirs?.length, `${agent.id} has Windows install directories`);
    ok(agent.installWin, `${agent.id} has a Windows install command`);
  }
  Assert.equal(pathEnvironment("/x").PATH, "/x");
});

add_task(function test_package_manager_directories() {
  // npm prints a prefix: executables sit in it on Windows, in bin elsewhere.
  Assert.equal(
    parseManagerDir("C:\\Users\\u\\AppData\\Roaming\\npm\r\n", true, true),
    "C:\\Users\\u\\AppData\\Roaming\\npm"
  );
  Assert.equal(
    parseManagerDir("/home/u/.npm-global\n", true, false),
    "/home/u/.npm-global/bin"
  );
  // The others print the directory, after any notice.
  Assert.equal(
    parseManagerDir(
      "update available\n/home/u/.local/share/pnpm\n",
      false,
      false
    ),
    "/home/u/.local/share/pnpm"
  );
  Assert.equal(
    parseManagerDir('"D:\\bun\\bin"\n', false, true),
    "D:\\bun\\bin"
  );
  // yarn 2+ has no `global`.
  Assert.equal(
    parseManagerDir("Usage Error: Couldn't find a script\n", false, false),
    null
  );
  Assert.equal(parseManagerDir("", true, true), null);
});

add_task(async function test_run_for_output_times_out() {
  const { stdout, exitCode } = await runForOutput("/bin/sh", ["-c", "echo hi"]);
  Assert.equal(stdout.trim(), "hi");
  Assert.equal(exitCode, 0);
  const slow = await runForOutput("/bin/sh", ["-c", "sleep 30"], { ms: 200 });
  Assert.equal(slow.exitCode, null, "a hung command is killed");
});

add_task(function test_claude_driver() {
  const { args, files } = ZENDIA_DRIVERS.claude.launch({
    ...TURN,
    resume: "s1",
  });
  Assert.equal(args[args.indexOf("--mcp-config") + 1], files[0].path);
  Assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__zendia");
  Assert.equal(args[args.indexOf("--resume") + 1], "s1");
  ok(
    !args.join(" ").includes("secret"),
    "the token stays off the command line"
  );
  Assert.equal(
    files[0].data.mcpServers.zendia.headers.Authorization,
    "Bearer secret"
  );
  ok(files[0].temporary, "its config is removed after the turn");

  const events = parseAll("claude", [
    { type: "system", subtype: "init", session_id: "s2" },
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "mcp__zendia__page_observe",
            input: {},
          },
          // Recorded from Claude Code 2.1.312, loading zendia's tools.
          { type: "tool_use", name: "ToolSearch", input: { query: "x" } },
          { type: "tool_use", name: "WebSearch", input: { query: "x" } },
          { type: "text", text: "Opened it" },
        ],
      },
    },
    { type: "result", is_error: false, session_id: "s2" },
  ]);
  Assert.deepEqual(events, [
    { type: "session", id: "s2" },
    { type: "tool", name: "WebSearch", input: { query: "x" } },
    { type: "text", text: "Opened it", final: true },
    { type: "session", id: "s2" },
    { type: "done", error: null },
  ]);
  Assert.deepEqual(
    parseAll("claude", [
      { type: "result", is_error: true, result: "Out of credit" },
    ]),
    [{ type: "done", error: "Out of credit" }]
  );
});

add_task(function test_claude_streams_its_answer() {
  ok(
    ZENDIA_DRIVERS.claude
      .launch(TURN)
      .args.includes("--include-partial-messages")
  );
  const delta = text => ({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
  });
  Assert.deepEqual(
    parseAll("claude", [
      { type: "stream_event", event: { type: "message_start" } },
      delta("**Pri"),
      delta("ce**"),
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "input_json_delta", partial_json: "{" },
        },
      },
    ]),
    [
      { type: "text", text: "**Pri", delta: true },
      { type: "text", text: "ce**", delta: true },
    ],
    "the answer's pieces, without the tool input's"
  );
});

add_task(function test_drivers_run_the_model_picked() {
  for (const [id, flag] of [
    ["claude", "--model"],
    ["cursor", "--model"],
    ["antigravity", "--model"],
    ["opencode", "--model"],
  ]) {
    const { args } = ZENDIA_DRIVERS[id].launch({ ...TURN, model: "m1" });
    Assert.equal(args[args.indexOf(flag) + 1], "m1", id);
    ok(
      !ZENDIA_DRIVERS[id].launch(TURN).args.includes(flag),
      `${id} keeps its own model when none is picked`
    );
  }
  const codex = ZENDIA_DRIVERS.codex.launch({
    ...TURN,
    model: "gpt-x",
    resume: "t1",
  }).args;
  ok(
    codex.indexOf('model="gpt-x"') < codex.indexOf("exec"),
    "codex takes it as config, which exec resume takes too"
  );
});

add_task(async function test_drivers_list_models() {
  const run = stdout => async () => ({ stdout, exitCode: 0 });
  // Recorded from agy, OpenCode and Codex on 2026-10-30.
  Assert.deepEqual(
    await ZENDIA_DRIVERS.antigravity.models(
      run(
        "Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n"
      )
    ),
    [
      {
        id: "gemini-4-argon-high",
        name: "Gemini 4 Argon (High)",
        input: ["text", "image", "pdf"],
      },
      {
        id: "claude-opus-5-5-low",
        name: "Claude Opus 5.5 (Low)",
        input: ["text", "image", "pdf"],
      },
    ]
  );
  Assert.deepEqual(
    (
      await ZENDIA_DRIVERS.opencode.models(
        run("opencode/big-pickle\nanthropic/claude-sonnet-5-5\n")
      )
    ).map(model => model.id),
    ["opencode/big-pickle", "anthropic/claude-sonnet-5-5"]
  );
  Assert.deepEqual(
    await ZENDIA_DRIVERS.codex.models(
      run(
        JSON.stringify({
          models: [
            { slug: "hidden", visibility: "hide", priority: 0 },
            {
              slug: "gpt-b",
              display_name: "GPT B",
              visibility: "list",
              priority: 2,
            },
            {
              slug: "gpt-a",
              display_name: "GPT A",
              description: "Fast",
              visibility: "list",
              priority: 1,
              default_reasoning_level: "medium",
              // Out of order on purpose: the list is ordered by effort.
              supported_reasoning_levels: [
                { effort: "high", description: "Deep" },
                { effort: "low", description: "Quick" },
                { effort: "medium", description: "Balanced" },
              ],
              context_window: 272000,
            },
          ],
        })
      )
    ),
    [
      {
        id: "gpt-a",
        name: "GPT A",
        detail: "Fast",
        efforts: ["low", "medium", "high"],
        defaultEffort: "medium",
        context: 272000,
      },
      { id: "gpt-b", name: "GPT B", detail: "" },
    ],
    "a model without levels or a window carries neither"
  );
  Assert.deepEqual(
    await ZENDIA_DRIVERS.codex.models(run("not json")),
    [],
    "an output it cannot read lists nothing"
  );
  const claude = await ZENDIA_DRIVERS.claude.models();
  Assert.deepEqual(
    claude.map(model => model.id),
    ["opus", "sonnet", "haiku"]
  );
  for (const model of claude) {
    Assert.deepEqual(
      model.efforts,
      ["low", "medium", "high", "xhigh", "max"],
      `${model.id} takes five levels`
    );
    Assert.equal(model.defaultEffort, "medium", model.id);
    Assert.deepEqual(model.contexts, [
      { id: "", label: "1M", default: true },
      { id: "200k", label: "200K" },
    ]);
  }
  Assert.deepEqual(
    {
      ...ZENDIA_DRIVERS.claude.defaultModel,
    },
    {
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
      contexts: [
        { id: "", label: "1M", default: true },
        { id: "200k", label: "200K" },
      ],
    },
    "with no model picked, the same options"
  );
  claude[0].efforts.push("changed");
  ok(
    !ZENDIA_DRIVERS.claude.defaultModel.efforts.includes("changed"),
    "a model's options are its own"
  );

  // Claude Code's answer to initialize, cut down from 2.1.330 on
  // 2026-11-23.
  const initialize = [
    '{"type":"system","subtype":"hook_started"}',
    JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "zendia-models",
        response: {
          models: [
            {
              value: "default",
              resolvedModel: "claude-opus-5-5",
              displayName: "Default (recommended)",
              supportsEffort: true,
              supportedEffortLevels: ["low", "medium", "high"],
            },
            {
              value: "opus",
              resolvedModel: "claude-opus-5-5",
              displayName: "Opus 5.5",
              description: "For complex work and everyday tasks",
              supportsEffort: true,
              supportedEffortLevels: ["max", "low", "medium", "high", "xhigh"],
              supportsAdaptiveThinking: true,
            },
            {
              value: "claude-haiku-4-5-20251001",
              resolvedModel: "claude-haiku-4-5-20251001",
              displayName: "Haiku 4.5",
              description: "Fastest for quick answers",
            },
          ],
        },
      },
    }),
  ].join("\n");
  let asked = null;
  const listed = await ZENDIA_DRIVERS.claude.models(async (args, options) => {
    asked = { args, options };
    return { stdout: initialize, exitCode: 0 };
  });
  Assert.deepEqual(listed, parseClaudeModels(initialize));
  Assert.deepEqual(
    listed,
    [
      {
        id: "opus",
        name: "Opus 5.5",
        detail: "claude-opus-5-5 · For complex work and everyday tasks",
        section: "Latest",
        input: ["text", "image", "pdf"],
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
        contexts: [
          { id: "", label: "1M", default: true },
          { id: "200k", label: "200K" },
        ],
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Haiku 4.5",
        detail: "Fastest for quick answers",
        section: "Earlier versions",
        input: ["text", "image", "pdf"],
        context: 200000,
      },
    ],
    "every model but the default, aliases as Latest, pinned ids after"
  );
  ok(
    asked.options.input.includes('"subtype":"initialize"'),
    "asks with the initialize control request on stdin"
  );
  ok(
    asked.args.includes("--no-session-persistence"),
    "and leaves no session behind"
  );
  Assert.deepEqual(
    (await ZENDIA_DRIVERS.claude.models(run("Not logged in\n"))).map(
      model => model.id
    ),
    ["opus", "sonnet", "haiku"],
    "a CLI that lists nothing leaves the aliases"
  );

  Assert.deepEqual(
    await ZENDIA_DRIVERS.kiro.models(
      run(
        JSON.stringify({
          models: [
            {
              model_id: "auto",
              model_name: "auto",
              context_window_tokens: 1e6,
            },
            { model_id: "glm-5", model_name: "glm-5" },
          ],
        })
      )
    ),
    [
      {
        id: "auto",
        name: "auto",
        detail: "",
        input: ["text", "image", "pdf"],
        context: 1e6,
      },
      { id: "glm-5", name: "glm-5", detail: "", input: ["text"] },
    ],
    "kiro reports its window and offers no efforts"
  );

  // OpenCode: the variants of a model are the efforts it takes.
  const verbose = `opencode/beam-free
{
  "id": "beam-free",
  "name": "Beam Free",
  "limit": { "context": 1048576, "output": 131072 },
  "capabilities": { "input": { "text": true, "image": false } },
  "variants": {
    "max": { "reasoningEffort": "max" },
    "low": { "reasoningEffort": "low" },
    "high": { "reasoningEffort": "high" }
  }
}
opencode/big-pickle
{
  "id": "big-pickle",
  "name": "Big Pickle",
  "limit": { "output": 1000 },
  "capabilities": { "input": { "text": true } },
  "variants": {}
}
`;
  Assert.deepEqual(
    await ZENDIA_DRIVERS.opencode.models(async args => ({
      stdout: args.includes("--verbose") ? verbose : "",
      exitCode: 0,
    })),
    [
      {
        id: "opencode/beam-free",
        name: "Beam Free",
        input: ["text"],
        efforts: ["low", "high", "max"],
        context: 1048576,
      },
      { id: "opencode/big-pickle", name: "Big Pickle", input: ["text"] },
    ],
    "no variants, no efforts; no window, no context"
  );
});

// Recorded from agy 1.5.1, with a model that has one variant only.
const AGY_LISTING = [
  "Fetching available models...",
  "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)",
  "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
  "gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)",
  "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
  "claude-opus-5-5-low\tClaude Opus 5.5 (Low)",
  "claude-opus-5-5-high\tClaude Opus 5.5 (High)",
  "",
].join("\n");

add_task(async function test_antigravity_folds_variants_into_models() {
  const models = await ZENDIA_DRIVERS.antigravity.models(async () => ({
    stdout: AGY_LISTING,
    exitCode: 0,
  }));
  Assert.deepEqual(models, [
    {
      id: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash",
      efforts: ["low", "medium", "high"],
      defaultEffort: "medium",
      effortInId: true,
      input: ["text", "image", "pdf"],
    },
    {
      id: "gpt-oss-120b-medium",
      name: "GPT-OSS 120B (Medium)",
      input: ["text"],
    },
    {
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      efforts: ["low", "high"],
      defaultEffort: "low",
      effortInId: true,
      input: ["text", "image", "pdf"],
    },
  ]);

  const odd = await ZENDIA_DRIVERS.antigravity.models(async () => ({
    stdout:
      "x-max\tX (Max)\nx-low\tX (Low)\nx-high\tX (High)\nx-xhigh\tNo label\n",
    exitCode: 0,
  }));
  Assert.deepEqual(odd, [
    {
      id: "x",
      name: "X",
      efforts: ["low", "high", "xhigh", "max"],
      defaultEffort: "high",
      effortInId: true,
    },
  ]);
});

add_task(function test_efforts_are_ordered() {
  const levels = ["max", "weird", "high", "ultra", "none", "odd", "low"];
  Assert.deepEqual(orderEfforts(levels), [
    "none",
    "low",
    "high",
    "max",
    "ultra",
    "weird",
    "odd",
  ]);
  Assert.equal(levels[0], "max", "the list given is not changed");
  Assert.deepEqual(
    orderEfforts(["minimal", "medium", "xhigh", "low", "high"]),
    ["minimal", "low", "medium", "high", "xhigh"]
  );
  Assert.deepEqual(orderEfforts([]), []);
});

add_task(function test_drivers_launch_with_effort_and_context() {
  const set = { ...TURN, model: "m1", effort: "high", context: "200k" };

  const claude = ZENDIA_DRIVERS.claude.launch(set).args;
  Assert.equal(claude[claude.indexOf("--effort") + 1], "high");
  Assert.equal(claude[claude.indexOf("--autocompact") + 1], "200k");
  const bare = ZENDIA_DRIVERS.claude.launch(TURN).args;
  ok(!bare.includes("--effort") && !bare.includes("--autocompact"), "claude");
  const noContext = ZENDIA_DRIVERS.claude.launch({
    ...set,
    context: null,
  }).args;
  ok(noContext.includes("--effort") && !noContext.includes("--autocompact"));

  for (const resume of [null, "t1"]) {
    const codex = ZENDIA_DRIVERS.codex.launch({
      ...set,
      effort: "xhigh",
      resume,
    }).args;
    ok(codex.includes('model_reasoning_effort="xhigh"'), "codex takes it");
    Assert.equal(
      codex[codex.indexOf('model_reasoning_effort="xhigh"') - 1],
      "-c"
    );
    ok(
      codex.indexOf('model_reasoning_effort="xhigh"') < codex.indexOf("exec"),
      "as config, before exec"
    );
    Assert.deepEqual(
      codex.slice(codex.indexOf("exec"), codex.indexOf("exec") + 2),
      resume ? ["exec", "resume"] : ["exec", "--json"]
    );
    ok(!codex.includes("--effort") && !codex.includes("--autocompact"));
  }
  ok(
    !ZENDIA_DRIVERS.codex
      .launch({ ...TURN, model: "m1" })
      .args.join(" ")
      .includes("model_reasoning_effort"),
    "codex keeps its own effort when none is picked"
  );

  const opencode = ZENDIA_DRIVERS.opencode.launch(set).args;
  Assert.equal(opencode[opencode.indexOf("--variant") + 1], "high");
  ok(!ZENDIA_DRIVERS.opencode.launch(TURN).args.includes("--variant"));

  const agy = ZENDIA_DRIVERS.antigravity.launch(set).args;
  Assert.equal(
    agy[agy.indexOf("--model") + 1],
    "m1-high",
    "agy takes the effort as part of the model"
  );
  ok(!agy.includes("--effort"), "and no --effort of its own");
  const agyPlain = ZENDIA_DRIVERS.antigravity.launch({
    ...set,
    effort: null,
  }).args;
  Assert.equal(agyPlain[agyPlain.indexOf("--model") + 1], "m1");

  for (const id of ["cursor", "kiro"]) {
    Assert.deepEqual(
      ZENDIA_DRIVERS[id].launch(set).args,
      ZENDIA_DRIVERS[id].launch({ ...TURN, model: "m1" }).args,
      `${id} sends no effort or context`
    );
  }
});

add_task(function test_codex_driver() {
  const { args } = ZENDIA_DRIVERS.codex.launch({
    ...TURN,
    resume: "t1",
    first: false,
  });
  ok(args.includes('mcp_servers.zendia.url="http://127.0.0.1:1234/mcp"'));
  ok(args.includes(`mcp_servers.zendia.bearer_token_env_var="${TOKEN_ENV}"`));
  Assert.deepEqual(args.slice(args.indexOf("exec"), args.indexOf("exec") + 2), [
    "exec",
    "resume",
  ]);
  ok(!args.join(" ").includes("secret"));
  Assert.equal(args.at(-2), "t1");
  Assert.equal(
    args.at(-1),
    "Open the docs",
    "no instructions after the first turn"
  );

  const events = parseAll("codex", [
    { type: "thread.started", thread_id: "t2" },
    {
      type: "item.completed",
      item: { type: "mcp_tool_call", server: "zendia", tool: "page_act" },
    },
    { type: "item.completed", item: { type: "agent_message", text: "Done" } },
    { type: "turn.failed", error: { message: "rate limited" } },
  ]);
  Assert.deepEqual(events, [
    { type: "session", id: "t2" },
    { type: "text", text: "Done" },
    { type: "done", error: "rate limited" },
  ]);
});

add_task(function test_antigravity_driver() {
  const { args } = ZENDIA_DRIVERS.antigravity.launch(TURN);
  ok(args.includes("--dangerously-skip-permissions"));
  Assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
  ok(args[1].includes("zendia") && args[1].endsWith("Open the docs"));
  ok(!args.includes("--conversation"));
  const resumed = ZENDIA_DRIVERS.antigravity.launch({
    ...TURN,
    resume: "c1",
  });
  Assert.equal(resumed.args[resumed.args.indexOf("--conversation") + 1], "c1");

  // Recorded from agy 1.4.9.
  const events = parseAll("antigravity", [
    { event: "init", conversation_id: "c2", init: { tools: [] } },
    {
      event: "step_update",
      step_update: { step_type: "user_input", state: "DONE" },
    },
    {
      event: "step_update",
      step_update: {
        step_type: "agent_response",
        state: "ACTIVE",
        text_delta: "o",
      },
    },
    {
      event: "step_update",
      step_update: {
        step_type: "agent_response",
        state: "DONE",
        text_delta: "k",
      },
    },
    { event: "result", result: { conversation_id: "c2", status: "SUCCESS" } },
  ]);
  Assert.deepEqual(events, [
    { type: "session", id: "c2" },
    { type: "text", text: "o", delta: true },
    { type: "text", text: "k", delta: true },
    { type: "done", error: null },
  ]);
});

add_task(function test_antigravity_hides_schema_reads_and_wrappers() {
  const step = (tool_name, parameters) => ({
    event: "step_update",
    step_update: {
      step_type: "tool",
      state: "ACTIVE",
      tool_name,
      tool_info: { name: tool_name, parameters },
    },
  });
  // Recorded from agy 1.4.11: it reads a tool's schema file, then calls the
  // tool through call_mcp_tool.
  Assert.deepEqual(
    parseAll("antigravity", [
      step("read_file", {
        Path: "/home/u/.gemini/antigravity-cli/mcp/zendia/page_act.json",
      }),
      step("call_mcp_tool", {
        ServerName: "zendia",
        ToolName: "page_act",
        Arguments: { action: "click", element: "e1" },
      }),
    ]),
    [],
    "neither the schema read nor our own tool is a row"
  );
  Assert.deepEqual(
    parseAll("antigravity", [
      step("read_file", { Path: "/home/u/notes.txt" }),
      step("call_mcp_tool", {
        ServerName: "other",
        ToolName: "lookup",
        Arguments: { q: 1 },
      }),
      step("read_url_content", { Url: "https://example.com" }),
    ]),
    [
      { type: "tool", name: "read_file", input: { Path: "/home/u/notes.txt" } },
      { type: "tool", name: "other.lookup", input: { q: 1 } },
      {
        type: "tool",
        name: "read_url_content",
        input: { Url: "https://example.com" },
      },
    ],
    "other reads, other servers' tools and agy's own web fetch show"
  );
});

add_task(function test_results_fit_an_agents_limit() {
  Assert.equal(fitResult("short", 100), "short", "a short result is kept");
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
  const cut = fitResult(lines, 1000);
  ok(cut.length <= 1000, `cut to the limit (${cut.length})`);
  ok(/line \d+\n\n\(Cut here to fit/.test(cut), "at a line's end, saying so");
  ok(cut.startsWith("line 0\nline 1\n"), "from the start");
});

add_task(function test_calls_are_taken_as_the_agent_meant_them() {
  const names = ["page_observe", "page_act", "browser_action", "tab_close"];
  const norm = (name, args) => normalizeCall(name, args, names);

  // A batch of actions, each under the names the tools understand.
  Assert.deepEqual(
    norm("page_act", {
      steps: [
        { action: "type", id: "e3", value: "Ada" },
        { action: "click", target: "e9" },
        "junk",
      ],
      tab: "t2",
    }),
    {
      name: "page_act",
      args: {
        actions: [
          {
            action: "fill",
            id: "e3",
            value: "Ada",
            element: "e3",
            text: "Ada",
          },
          {
            action: "click",
            target: "e9",
            element: "e9",
            text: undefined,
          },
          { element: undefined, text: undefined },
        ],
        tab: "t2",
      },
    },
    "steps is taken for actions, and each is normalized"
  );

  // agy's wrapper, plain and nested again, and with the arguments beside it.
  Assert.deepEqual(
    norm("call_mcp_tool", {
      ServerName: "zendia",
      ToolName: "browser_action",
      Arguments: { id: "scroll.pageDown", tab: "t1" },
    }),
    {
      name: "browser_action",
      args: { id: "scroll.pageDown", args: undefined, tab: "t1" },
    }
  );
  Assert.deepEqual(
    norm("call_mcp_tool", {
      ServerName: "zendia",
      ToolName: "call_mcp_tool",
      Arguments: {
        ServerName: "zendia",
        ToolName: "page_observe",
        Arguments: { tab: "t2" },
      },
    }),
    { name: "page_observe", args: { tab: "t2" } }
  );
  Assert.equal(
    norm("page_act", { ServerName: "x", ToolName: "page_act", action: "click" })
      .args.ServerName,
    undefined
  );
  Assert.equal(norm("mcp__zendia__page_act", {}).name, "page_act");
  Assert.equal(norm("zendia.tab_close", {}).name, "tab_close");
  Assert.equal(norm("nope", {}).name, "nope");

  // Argument names from memory.
  let { args } = norm("page_act", { action: "click", id: "e75", tab: "t7" });
  Assert.equal(args.element, "e75");
  ({ args } = norm("page_act", { action: "click", target: "e5" }));
  Assert.equal(args.element, "e5");
  ({ args } = norm("page_act", { action: "fill", element: "e2", value: "Mr" }));
  Assert.equal(args.text, "Mr");
  ({ args } = norm("page_act", { action: "key", key: "Enter" }));
  Assert.deepEqual([args.action, args.text], ["press", "Enter"]);
  ({ args } = norm("page_act", {
    action: "scroll",
    direction: "down",
    distance: 800,
  }));
  Assert.deepEqual([args.action, args.text], ["scroll", "down"]);
  ({ args } = norm("page_act", { action: "scroll_up" }));
  Assert.deepEqual([args.action, args.text], ["scroll", "up"]);
  ({ args } = norm("page_act", { action: "constructor" }));
  Assert.equal(args.action, "constructor", "no alias from the prototype");
  ({ args } = norm("page_act", { action: "click", element: "e1", id: "e9" }));
  Assert.equal(args.element, "e1", "the real name wins");
  ({ args } = norm("browser_action", { action: "history.back", count: 2 }));
  Assert.deepEqual([args.id, args.args], ["history.back", { count: 2 }]);
});

add_task(async function test_antigravity_connects_once() {
  const calls = [];
  const agy = async args => {
    calls.push(args);
    return args[1] == "list"
      ? { stdout: "NAME  TYPE  STATUS\nplanck  stdio  enabled\n", exitCode: 0 }
      : { stdout: "", exitCode: 0 };
  };
  ok(await ZENDIA_DRIVERS.antigravity.ensureConnected(agy));
  Assert.deepEqual(calls[1].slice(0, 6), [
    "mcp",
    "add",
    "zendia",
    "--",
    "/bin/sh",
    "-c",
  ]);
  Assert.equal(calls[1][6], STDIO_PROXY);

  calls.length = 0;
  const connected = async args => {
    calls.push(args);
    return { stdout: "NAME TYPE\nzendia  stdio  enabled\n", exitCode: 0 };
  };
  ok(await ZENDIA_DRIVERS.antigravity.ensureConnected(connected));
  Assert.equal(calls.length, 1, "nothing is added twice");
});

add_task(async function test_antigravity_drops_the_lazyvimium_server() {
  const calls = [];
  const agy = async args => {
    calls.push(args);
    return args[1] == "list"
      ? {
          stdout:
            "NAME        TYPE   STATUS   COMMAND/URL\n" +
            'lazyvimium  stdio  enabled  /bin/sh -c [ -n "$LAZYVIMIUM_MCP_URL" ] || exit 0\n' +
            "planck  stdio  enabled  /usr/bin/planck-mcp\n",
          exitCode: 0,
        }
      : { stdout: "", exitCode: 0 };
  };
  ok(await ZENDIA_DRIVERS.antigravity.ensureConnected(agy));
  Assert.deepEqual(
    calls.map(args => args.slice(0, 3)),
    [
      ["mcp", "list"],
      ["mcp", "remove", "lazyvimium"],
      ["mcp", "add", "zendia"],
    ],
    "the old entry goes and zendia is added"
  );

  calls.length = 0;
  const own = async args => {
    calls.push(args);
    return {
      stdout:
        "NAME TYPE\nlazyvimium  stdio  enabled  /usr/bin/something-else\n" +
        "zendia  stdio  enabled\n",
      exitCode: 0,
    };
  };
  ok(await ZENDIA_DRIVERS.antigravity.ensureConnected(own));
  Assert.equal(calls.length, 1, "a lazyvimium server of the user's stays");
});

add_task(async function test_stdio_proxy_per_system() {
  Assert.deepEqual(stdioProxyCommand(false), ["/bin/sh", "-c", STDIO_PROXY]);
  const windows = stdioProxyCommand(true);
  ok(windows[0].endsWith("\\WindowsPowerShell\\v1.0\\powershell.exe"));
  Assert.equal(windows.at(-2), "-EncodedCommand");
  Assert.equal(
    new TextDecoder("utf-16le").decode(
      Uint8Array.from(atob(windows.at(-1)), c => c.charCodeAt(0))
    ),
    WINDOWS_STDIO_PROXY,
    "the script survives as base64 UTF-16"
  );

  // The other system's proxy, from a profile carried over, is replaced.
  const calls = [];
  const agy = async args => {
    calls.push(args);
    return {
      stdout:
        args[1] == "list"
          ? "NAME  TYPE  STATUS  COMMAND/URL\nzendia  stdio  enabled  C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile\n"
          : "",
      exitCode: 0,
    };
  };
  ok(await ZENDIA_DRIVERS.antigravity.ensureConnected(agy));
  Assert.deepEqual(
    calls.map(args => args.slice(0, 5)),
    [
      ["mcp", "list"],
      ["mcp", "remove", "zendia"],
      ["mcp", "add", "zendia", "--", "/bin/sh"],
    ]
  );
});

add_task(function test_newest_cursor_version() {
  Assert.equal(
    newestCursorVersion([
      "2026.9.3-abc123",
      "2026.11.22-e9042b2",
      "2026.11.5-aaa",
      "2026.12.02-abc.new",
      "promote-staged.cmd",
    ]),
    "2026.11.22-e9042b2",
    "by the date, as cursor-agent.ps1 sorts"
  );
  Assert.equal(newestCursorVersion(["x"]), null);
});

add_task(function test_opencode_and_cursor_drivers() {
  const { args, env, files } = ZENDIA_DRIVERS.opencode.launch(TURN);
  Assert.equal(env.OPENCODE_CONFIG, files[0].path);
  Assert.equal(
    files[0].data.mcp.zendia.headers.Authorization,
    `Bearer {env:${TOKEN_ENV}}`
  );
  Assert.deepEqual(args.slice(0, 3), ["run", "--format", "json"]);
  Assert.deepEqual(
    parseAll("opencode", [
      { type: "text", sessionID: "o1", part: { text: "Hi" } },
      { type: "error", error: { data: { message: "No model" } } },
    ]),
    [
      { type: "session", id: "o1" },
      { type: "text", text: "Hi" },
      { type: "done", error: "No model" },
    ]
  );

  const cursor = ZENDIA_DRIVERS.cursor.launch(TURN);
  ok(cursor.files[0].path.endsWith(".cursor/mcp.json"));
  Assert.equal(
    cursor.files[0].data.mcpServers.zendia.headers.Authorization,
    `Bearer \${env:${TOKEN_ENV}}`
  );
  ok(cursor.args.includes("--approve-mcps"));
});

add_task(async function test_kiro_driver() {
  const turn = { ...TURN, model: "claude-sonnet-4.5", resume: "sess_1" };
  const { args, files } = ZENDIA_DRIVERS.kiro.launch(turn);
  Assert.deepEqual(args.slice(0, 5), [
    "chat",
    "--output-format",
    "stream-json",
    "--trust-workspace",
    "--agent",
  ]);
  Assert.equal(args[args.indexOf("--model") + 1], "claude-sonnet-4.5");
  Assert.equal(args[args.indexOf("--resume-id") + 1], "sess_1");
  ok(args.at(-1).includes("Open the docs"));
  const [mcp, agent] = files;
  ok(mcp.path.endsWith(".kiro/settings/mcp.json"));
  Assert.equal(
    mcp.data.mcpServers.zendia.headers.Authorization,
    `Bearer \${${TOKEN_ENV}}`,
    "the token is read from the environment, never written"
  );
  ok(!JSON.stringify(files).includes("secret"));
  ok(agent.path.endsWith(".kiro/agents/zendia.json"));
  Assert.deepEqual(
    [agent.data.tools, agent.data.allowedTools],
    [["@zendia"], ["@zendia"]],
    "only the browser tools, already allowed"
  );

  const update = (sessionUpdate, extra = {}) => ({
    type: "sessionUpdate",
    data: { sessionId: "s9", update: { sessionUpdate, ...extra } },
  });
  Assert.deepEqual(
    parseAll("kiro", [
      { type: "runStarted", data: {} },
      update("agent_message_chunk", { content: { type: "text", text: "po" } }),
      update("tool_call", {
        title: "@zendia/page_observe",
        rawInput: { tool_id: "zendia::page_observe", arguments: {} },
      }),
      update("tool_call", {
        title: "@other/search",
        rawInput: { arguments: { q: "x" } },
      }),
      {
        type: "runFinished",
        data: { sessionId: "s9", status: "success", finalText: "pong" },
      },
      { type: "runFinished", data: { status: "error", error: "no login" } },
    ]),
    [
      { type: "session", id: "s9" },
      { type: "text", text: "po", delta: true },
      { type: "session", id: "s9" },
      { type: "session", id: "s9" },
      { type: "tool", name: "@other/search", input: { q: "x" } },
      { type: "session", id: "s9" },
      { type: "done", error: null },
      { type: "done", error: "no login" },
    ],
    "text streams, its own tools stay quiet, the run ends the turn"
  );

  const run = stdout => async () => ({ stdout, exitCode: 0 });
  Assert.deepEqual(
    await ZENDIA_DRIVERS.kiro.models(
      run(
        JSON.stringify({
          models: [
            { model_id: "auto", model_name: "auto", description: "by task" },
            { model_id: "deepseek-3.2", model_name: "deepseek-3.2" },
          ],
        })
      )
    ),
    [
      {
        id: "auto",
        name: "auto",
        detail: "by task",
        input: ["text", "image", "pdf"],
      },
      { id: "deepseek-3.2", name: "deepseek-3.2", detail: "", input: ["text"] },
    ]
  );
});

add_task(async function test_models_say_what_they_read() {
  Assert.deepEqual(guessInputs("deepseek-3.2"), ["text"]);
  Assert.deepEqual(guessInputs("claude-haiku-4.5"), ["text", "image", "pdf"]);
  Assert.equal(guessInputs("some-new-model"), undefined, "unknown stays so");

  // OpenCode: the model's id, then its JSON, one after the other.
  const verbose = `opencode/beam-free
{
  "id": "beam-free",
  "name": "Beam Free",
  "capabilities": { "input": { "text": true, "image": false, "pdf": false } }
}
anthropic/claude-sonnet-5-5
{
  "id": "claude-sonnet-5-5",
  "name": "Claude Sonnet 5.5",
  "capabilities": { "input": { "text": true, "image": true, "pdf": true } }
}
`;
  const models = await ZENDIA_DRIVERS.opencode.models(async args => ({
    stdout: args.includes("--verbose") ? verbose : "",
    exitCode: 0,
  }));
  Assert.deepEqual(models, [
    { id: "opencode/beam-free", name: "Beam Free", input: ["text"] },
    {
      id: "anthropic/claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      input: ["text", "image", "pdf"],
    },
  ]);

  Assert.deepEqual(
    (
      await ZENDIA_DRIVERS.codex.models(async () => ({
        stdout: JSON.stringify({
          models: [
            {
              slug: "g",
              display_name: "G",
              input_modalities: ["text", "image"],
            },
          ],
        }),
        exitCode: 0,
      }))
    ).map(model => model.input),
    [["text", "image"]]
  );
});

add_task(async function test_mcp_messages() {
  const session = fakeSession();
  const init = await handleMcpMessage(session, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  Assert.equal(init.result.protocolVersion, "2025-06-18");
  ok(init.result.capabilities.tools);
  const unknownVersion = await handleMcpMessage(session, {
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: { protocolVersion: "1999-01-01" },
  });
  Assert.equal(unknownVersion.result.protocolVersion, "2025-11-25");

  Assert.equal(
    await handleMcpMessage(session, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    null
  );
  const list = await handleMcpMessage(session, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
  });
  Assert.equal(list.result.tools[0].name, "page_observe");
  const call = await handleMcpMessage(session, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "page_observe", arguments: { a: 1 } },
  });
  Assert.deepEqual(call.result, {
    content: [{ type: "text", text: 'observed {"a":1}' }],
    isError: false,
  });
  const failed = await handleMcpMessage(session, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "fail" },
  });
  ok(
    failed.result.isError,
    "a failed tool is a tool error, not a protocol one"
  );
  const unknown = await handleMcpMessage(session, {
    jsonrpc: "2.0",
    id: 6,
    method: "resources/list",
  });
  Assert.equal(unknown.error.code, -32601);
});

add_task(async function test_server_needs_a_live_token() {
  const calls = [];
  const token = ZendiaAgentServer.open(fakeSession(calls));
  const url = ZendiaAgentServer.url;
  ok(url.startsWith("http://127.0.0.1:"));
  const call = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "page_observe", arguments: { note: "héllo ✓" } },
  };

  let response = await post(url, call, { Authorization: `Bearer ${token}` });
  Assert.equal(response.status, 200);
  const body = await response.json();
  Assert.equal(body.result.content[0].text, 'observed {"note":"héllo ✓"}');

  response = await post(url, call);
  Assert.equal(response.status, 401, "no token, no tools");
  response = await post(url, call, { Authorization: "Bearer guessed" });
  Assert.equal(response.status, 401);
  // fetch drops Origin, a forbidden header; a page's request carries it.
  const fromPage = await runForOutput("/usr/bin/env", [
    "curl",
    "-s",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Origin: https://evil.example",
    "--data-binary",
    JSON.stringify(call),
    url,
  ]);
  Assert.equal(fromPage.stdout, "403", "web pages are refused");
  response = await post(
    url,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { Authorization: `Bearer ${token}` }
  );
  Assert.equal(response.status, 202);
  response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  Assert.equal(response.status, 405, "no event stream");

  ZendiaAgentServer.close(token);
  response = await post(url, call, { Authorization: `Bearer ${token}` });
  Assert.equal(response.status, 401, "a closed run's token is dead");
  Assert.equal(calls.length, 1);
});

add_task(async function test_stdio_proxy() {
  const token = ZendiaAgentServer.open(fakeSession());
  const proc = await Subprocess.call({
    command: "/bin/sh",
    arguments: ["-c", STDIO_PROXY],
    environment: { [URL_ENV]: ZendiaAgentServer.url, [TOKEN_ENV]: token },
    environmentAppend: true,
    stderr: "stdout",
  });
  await proc.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}\n`
  );
  await proc.stdin.close();
  let output = "";
  let chunk;
  while ((chunk = await proc.stdout.readString())) {
    output += chunk;
  }
  await proc.wait();
  const lines = output.trim().split("\n");
  Assert.equal(lines.length, 1, "notifications get no line back");
  Assert.equal(JSON.parse(lines[0]).result.tools[0].name, "page_observe");
  ZendiaAgentServer.close(token);

  const idle = await runForOutput("/bin/sh", ["-c", STDIO_PROXY], { ms: 2000 });
  Assert.equal(idle.exitCode, 0, "outside a zendia run it exits at once");
});

add_task(async function test_run_with_a_fake_agent() {
  const dir = PathUtils.join(PathUtils.profileDir, "fake-agent");
  await IOUtils.makeDirectory(dir);
  const script = PathUtils.join(dir, "claude");
  // An agent in Claude Code's stream-json shapes, which reads its MCP config
  // file and calls a tool with curl.
  await IOUtils.writeUTF8(
    script,
    `#!/bin/sh
config=""
while [ $# -gt 0 ]; do
  [ "$1" = "--mcp-config" ] && config="$2"
  shift
done
token=$(sed -n 's/.*"Authorization": "Bearer \\([0-9a-f]*\\)".*/\\1/p' "$config")
echo '{"type":"system","subtype":"init","session_id":"fake-1"}'
answer=$(printf '%s' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"page_observe","arguments":{}}}' |
  curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data-binary @- "$${URL_ENV}")
case "$answer" in *observed*) said="saw the page" ;; *) said="saw nothing" ;; esac
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"'"$said"'"}]}}'
echo '{"type":"result","is_error":false,"result":"ok","session_id":"fake-1"}'
`
  );
  await IOUtils.setPermissions(script, 0o755);

  const calls = [];
  const token = ZendiaAgentServer.open(fakeSession(calls));
  const events = [];
  const log = new ZendiaAgentLog({
    dir: PathUtils.join(dir, "logs"),
    agent: "claude",
  });
  const run = new ZendiaAgentRun({
    driver: ZENDIA_DRIVERS.claude,
    executable: script,
    path: "/usr/bin:/bin",
    turn: {
      ...TURN,
      dir,
      mcp: { url: ZendiaAgentServer.url, token },
    },
    onEvent: event => events.push(event),
    log,
  });
  await run.start();
  Assert.equal(await run.done, null);
  ZendiaAgentServer.close(token);

  // The process exits just after its result line.
  let entries = [];
  await TestUtils.waitForCondition(async () => {
    await log.flush();
    const text = await IOUtils.readUTF8(log.path);
    entries = text
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    return entries.some(entry => entry.kind == "exit");
  }, "the log records the exit");
  const kinds = entries.map(entry => entry.kind);
  Assert.equal(kinds[0], "spawn", "it starts with the command line");
  Assert.equal(entries[0].executable, script);
  Assert.equal(
    kinds.filter(kind => kind == "stdout").length,
    3,
    "every line the agent printed"
  );
  ok(kinds.includes("event"), "and what the driver made of them");
  Assert.equal(entries.find(entry => entry.kind == "exit").exitCode, 0);
  ok(
    !(await IOUtils.readUTF8(log.path)).includes(token),
    "the token never reaches the log"
  );
  Assert.equal(
    (await IOUtils.stat(log.path)).permissions & 0o077,
    0,
    "only the user can read it"
  );

  Assert.deepEqual(events, [
    { type: "session", id: "fake-1" },
    { type: "text", text: "saw the page", final: true },
    { type: "session", id: "fake-1" },
    { type: "done", error: null },
  ]);
  Assert.equal(calls.length, 1, "the agent reached the tools");
  const left = (await IOUtils.getChildren(dir)).filter(path =>
    path.includes("claude-mcp-")
  );
  Assert.deepEqual(left, [], "the config with the token is removed");
});

add_task(async function test_run_reports_a_failing_agent() {
  const events = [];
  const run = new ZendiaAgentRun({
    driver: ZENDIA_DRIVERS.codex,
    executable: "/bin/sh",
    path: "/usr/bin:/bin",
    turn: { ...TURN, dir: PathUtils.join(PathUtils.profileDir, "fake-agent") },
    onEvent: event => events.push(event),
  });
  // /bin/sh runs codex's arguments: "-c" then a config string as a script.
  await run.start();
  const error = await run.done;
  ok(error, "a non-zero exit is an error");
  Assert.equal(events.at(-1).type, "done");
});

add_task(function test_observation_text() {
  const text = formatObservation({
    url: "https://example.com/",
    title: "Example",
    loading: false,
    scroll: { y: 0, height: 2000, viewport: 800 },
    elements: [
      { id: "e1", role: "link", label: "Docs" },
      { id: "e4", role: "textbox", label: "Search", value: "", editable: true },
      {
        id: "e9",
        role: "combobox",
        label: "Lang",
        value: "English",
        options: ["English", "Deutsch"],
      },
      { id: "e12", role: "checkbox", label: "Remember", checked: "false" },
    ],
    omitted: 3,
    text: "Welcome",
    selection: "picked words",
  });
  Assert.equal(
    text,
    [
      "Title: Example",
      "URL: https://example.com/",
      "Scroll: 0 of 1200px",
      "More below: 1200px, about 2 screens. The controls and text listed are only what is in view.",
      'Selected text: "picked words"',
      "",
      "Elements in view:",
      '[e1] link "Docs"',
      '[e4] textbox "Search" value="" (editable)',
      '[e9] combobox "Lang" value="English" options: "English", "Deutsch"',
      '[e12] checkbox "Remember" checked=false',
      "(3 more not listed; scroll or act to see them)",
      "",
      "Visible text:",
      "Welcome",
    ].join("\n")
  );
  ok(
    formatObservation({
      url: "https://example.com/",
      title: "",
      scroll: { y: 10.4, height: 4050.4666748046875, viewport: 800 },
      elements: [],
      text: "",
    }).includes("Scroll: 10 of 3250px"),
    "scroll positions are whole pixels"
  );
  ok(
    formatObservation({
      url: "https://music.youtube.com/",
      title: "",
      scroll: { y: 0, height: 800, viewport: 800 },
      elements: [
        {
          id: "e70",
          role: "button",
          label: "Play",
          covered: 'ytmusic-player-page "Up next"',
        },
      ],
      text: "",
    }).includes(
      '[e70] button "Play" (covered by ytmusic-player-page "Up next")'
    ),
    "covered controls say so"
  );
});

add_task(function test_observation_text_says_what_it_does_not_show() {
  const text = formatObservation(
    {
      url: "https://dex.example/",
      title: "Pairs",
      scroll: { y: 0, height: 5000, viewport: 1000 },
      elements: [],
      text: "TRUMP",
      textCut: true,
      data: [
        {
          id: "e301",
          kind: "table",
          label: "Trending",
          rows: 100,
          cols: 11,
          inView: 14,
          first: "#1 | TRUMP",
        },
      ],
      pagers: [
        { id: "e44", role: "link", label: "Pairs 201-300", where: "below" },
      ],
    },
    "t1"
  );
  for (const line of [
    "More below: 4000px, about 4 screens.",
    'Paging controls out of view (click one to scroll to it and use it):\n[e44] link "Pairs 201-300" (below)',
    '[e301] table "Trending": 100 rows x 11 columns, 14 in view; first row: "#1 | TRUMP"',
    "page_extract reads a table or list whole.",
  ]) {
    ok(text.includes(line), `the observation says: ${line}`);
  }
  ok(
    !formatObservation({
      url: "https://example.com/",
      title: "",
      scroll: { y: 0, height: 1100, viewport: 1000 },
      elements: [],
      text: "",
    }).includes("More below"),
    "a page that is a little taller than the window does not say it"
  );
});

add_task(function test_observation_text_reads_frames_and_hands_over_captchas() {
  const page = {
    url: "https://shop.example/",
    title: "Shop",
    scroll: { y: 0, height: 800, viewport: 800 },
    elements: [],
    text: "Pay",
    frames: [
      {
        id: 7,
        title: "Card",
        src: "https://pay.example/card",
        rect: { x: 10, y: 20, w: 300, h: 80 },
        page: {
          url: "https://pay.example/card",
          title: "",
          elements: [{ id: "e2", role: "textbox", label: "Number" }],
          text: "Card number",
          frames: [
            {
              id: 9,
              title: "",
              src: "https://www.google.com/recaptcha/api2/bframe",
              rect: { x: 0, y: 0, w: 400, h: 500 },
            },
          ],
        },
      },
      {
        id: 8,
        title: "",
        src: "https://ads.example/",
        rect: { x: 0, y: 700, w: 300, h: 100 },
        page: null,
      },
      {
        id: 11,
        title: "",
        src: "https://more.example/",
        rect: { x: 0, y: 0, w: 10, h: 10 },
        skipped: true,
      },
    ],
  };
  const text = formatObservation(page, "t1");
  const frames = text.split("Visible text:\nPay\n")[1];
  Assert.equal(
    frames,
    [
      '\nFrame f7 "Card" at 10,20 300x80: https://pay.example/card',
      "Elements in view:",
      '[f7.e2] textbox "Number"',
      "",
      "Visible text:",
      "Card number",
      "",
      "Frame f9 at 0,0 400x500: https://www.google.com/recaptcha/api2/bframe",
      "This is a reCAPTCHA challenge, a check made for the user. Do not click in it or try to solve it. Tell the user to complete it and end your turn: you are told to carry on once it is cleared.",
      "",
      "Frame f8 at 0,700 300x100: https://ads.example/",
      "(could not be read)",
      "",
      "Frame f11 at 0,0 10x10: https://more.example/",
      "(not read: too many frames)",
    ].join("\n")
  );
});

add_task(function test_observation_text_shows_outline_and_accessible_state() {
  const text = formatObservation({
    url: "https://example.com/",
    title: "Shop",
    scroll: { y: 0, height: 800, viewport: 800 },
    outline: [
      { id: "e1", role: "main", label: "", inView: true },
      { id: "e2", role: "heading", level: 1, label: "Shop", inView: true },
      { id: "e3", role: "heading", level: 2, label: "Far", inView: false },
      { id: "e4", role: "form", label: "Sign up", inView: true },
    ],
    elements: [
      {
        id: "e9",
        role: "textbox",
        label: "Email",
        description: "We never share it",
        value: "",
        editable: true,
        required: true,
        invalid: true,
        focused: true,
      },
      { id: "e10", role: "button", label: "Mute", pressed: "true" },
    ],
    text: "",
  });
  Assert.equal(
    text.split("\n").slice(3).join("\n"),
    [
      "",
      "Outline (use an id as scope to read only that part):",
      "[e1] main",
      '[e2] heading 1 "Shop"',
      '  [e3] heading 2 "Far" (out of view)',
      '[e4] form "Sign up"',
      "",
      "Elements in view:",
      '[e9] textbox "Email" description="We never share it" value="" focused required invalid (editable)',
      '[e10] button "Mute" pressed=true',
      "",
      "Visible text:",
      "(none)",
    ].join("\n")
  );

  const scoped = formatObservation({
    url: "https://pay.example/",
    title: "",
    scroll: { y: 0, height: 100, viewport: 100 },
    prefix: "f7.",
    scope: "e3",
    elements: [{ id: "e5", role: "button", label: "Pay" }],
    text: "Pay",
  });
  ok(scoped.includes('Elements in f7.e3:\n[f7.e5] button "Pay"'), scoped);
});

add_task(async function test_a_screenshot_is_an_image_in_the_reply() {
  const session = {
    listTools: () => [],
    callTool: async () => ({
      text: "Screenshot of t1",
      image: { data: "AAEC", mimeType: "image/jpeg" },
    }),
  };
  const reply = await handleMcpMessage(session, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "page_screenshot", arguments: {} },
  });
  Assert.deepEqual(reply.result, {
    content: [
      { type: "text", text: "Screenshot of t1" },
      { type: "image", data: "AAEC", mimeType: "image/jpeg" },
    ],
    isError: false,
  });
});

add_task(async function test_log_redacts_and_rotates() {
  const dir = PathUtils.join(PathUtils.profileDir, "logs-test");
  const log = new ZendiaAgentLog({ dir, agent: "codex" });
  log.hide("s3cret-token");
  log.write("spawn", {
    executable: "/bin/codex",
    args: ["exec", "Bearer s3cret-token"],
  });
  log.write("tool", {
    name: "page_act",
    args: { action: "click", element: "e4" },
    ms: 140,
    isError: true,
    title: "click e4",
    text: "e4 is covered by div",
  });
  await log.flush();
  const text = await IOUtils.readUTF8(log.path);
  ok(text.includes("Bearer <token>"), "a hidden value is replaced");
  ok(!text.includes("s3cret-token"));
  Assert.equal(text.trim().split("\n").length, 2);
  Assert.equal(
    summarize(JSON.parse(text.trim().split("\n")[1])),
    'page_act {"action":"click","element":"e4"} → ERROR 140ms click e4'
  );

  for (let i = 0; i < 55; i++) {
    await IOUtils.writeUTF8(
      PathUtils.join(
        dir,
        `20200101-0000${String(i).padStart(2, "0")}-old.jsonl`
      ),
      ""
    );
  }
  new ZendiaAgentLog({ dir, agent: "codex" }).write("turn", {});
  await TestUtils.waitForCondition(
    async () => (await IOUtils.getChildren(dir)).length <= 50,
    "old logs are pruned"
  );
  ok(
    (await IOUtils.getChildren(dir)).some(path => path == log.path),
    "the newest ones stay"
  );

  Services.prefs.setBoolPref("zendia.agent.log.enabled", false);
  const off = new ZendiaAgentLog({ dir, agent: "codex" });
  off.write("turn", {});
  Assert.equal(off.path, null, "logging can be turned off");
  Services.prefs.clearUserPref("zendia.agent.log.enabled");
});

add_task(function test_keys_parse_as_agents_name_them() {
  const { parseKey } = ChromeUtils.importESModule(
    "resource:///modules/zendia/plugins/ZendiaAgentContent.sys.mjs"
  );
  const keyOf = text => {
    const parsed = parseKey(text);
    return parsed && [parsed.key, ...parsed.modifiers.map(m => m.key)];
  };
  Assert.deepEqual(keyOf("Enter"), ["Enter"]);
  Assert.deepEqual(keyOf("enter"), ["Enter"], "any case");
  Assert.deepEqual(keyOf("Space"), [" "]);
  Assert.deepEqual(keyOf("Esc"), ["Escape"]);
  Assert.deepEqual(keyOf("Shift+Tab"), ["Tab", "Shift"]);
  Assert.deepEqual(keyOf("Ctrl+a"), ["a", "Control"]);
  Assert.equal(parseKey("Control+a").info.keyCode, 65, "letters carry codes");
  Assert.deepEqual(keyOf("Control++"), ["+", "Control"]);
  Assert.deepEqual(keyOf("+"), ["+"]);
  Assert.equal(parseKey("Hyper+Q"), null);
  Assert.equal(parseKey("NotAKey"), null);
});

// The service remembers lists in a file it reads once, so the test that
// writes that file must be the first to use the service.
add_task(async function test_remembered_lists_have_a_version() {
  const dir = PathUtils.join(
    PathUtils.join(PathUtils.profileDir, "zendia"),
    "agent"
  );
  const file = PathUtils.join(dir, "models-cache.json");
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  const opus = { id: "opus", name: "Opus", efforts: ["low", "high"] };
  await IOUtils.writeJSON(file, {
    claude: { v: 2, at: Date.now(), models: [opus] },
    codex: { at: Date.now(), models: [{ id: "old", name: "Old" }] },
    kiro: { v: 1, at: Date.now(), models: [{ id: "old", name: "Old" }] },
  });

  // Reading what is remembered never asks a CLI.
  const originals = {};
  let asked = 0;
  for (const id of ["claude", "codex", "kiro"]) {
    originals[id] = ZENDIA_DRIVERS[id].models;
    ZENDIA_DRIVERS[id].models = async () => {
      asked++;
      return [{ id: "new", name: "New" }];
    };
  }
  try {
    for (const id of ["claude", "codex", "kiro"]) {
      await ZendiaAgents.loadRememberedModels(id);
    }
    Assert.deepEqual(ZendiaAgents.modelsNow("claude"), [opus]);
    Assert.deepEqual(
      ZendiaAgents.modelsNow("codex"),
      [],
      "a list without a version is missing"
    );
    Assert.deepEqual(
      ZendiaAgents.modelsNow("kiro"),
      [],
      "so is one of another version"
    );
    Assert.equal(asked, 0, "no CLI was asked");

    const agent = { id: "kiro", name: "Kiro", path: "/bin/true" };
    Assert.deepEqual(
      await ZendiaAgents.models(agent),
      [{ id: "new", name: "New" }],
      "an old list is not answered with"
    );
    Assert.equal(asked, 1, "the CLI is asked in its place");
    let written = null;
    for (let i = 0; i < 100 && written?.v != 2; i++) {
      await new Promise(resolve => do_timeout(50, resolve));
      written = (await IOUtils.readJSON(file)).kiro;
    }
    Assert.equal(written?.v, 2, "the new list is written with the version");
    Assert.deepEqual(written.models, [{ id: "new", name: "New" }]);
  } finally {
    for (const id in originals) {
      ZENDIA_DRIVERS[id].models = originals[id];
    }
  }
});

function clearPicks() {
  for (const id of ["claude", "codex", "antigravity"]) {
    ZendiaAgents.setModel(id, "");
    ZendiaAgents.setEffort(id, "");
    ZendiaAgents.setContext(id, "");
  }
}

// Run with these as the models the agents list this session.
function withModels(models, fn) {
  ZendiaAgents.modelsNow = id => models[id] ?? [];
  try {
    return fn();
  } finally {
    delete ZendiaAgents.modelsNow;
    clearPicks();
  }
}

add_task(function test_effort_and_context_are_picked_per_agent() {
  try {
    Assert.equal(ZendiaAgents.effortFor("codex"), "");
    ZendiaAgents.setEffort("codex", "high");
    ZendiaAgents.setContext("codex", "200k");
    Assert.equal(ZendiaAgents.effortFor("codex"), "high");
    Assert.equal(ZendiaAgents.contextFor("codex"), "200k");
    Assert.equal(ZendiaAgents.effortFor("claude"), "", "per agent");
    Assert.equal(
      Services.prefs.getStringPref(`${PREF_EFFORT}codex`),
      "high",
      "in the effort pref"
    );
    Assert.equal(Services.prefs.getStringPref(`${PREF_CONTEXT}codex`), "200k");
    ZendiaAgents.setEffort("codex", "");
    ZendiaAgents.setContext("codex", "");
    ok(!Services.prefs.prefHasUserValue(`${PREF_EFFORT}codex`), "cleared");
    ok(!Services.prefs.prefHasUserValue(`${PREF_CONTEXT}codex`), "cleared");
  } finally {
    clearPicks();
  }
});

add_task(function test_options_send_no_effort_the_user_did_not_pick() {
  const codex = {
    id: "gpt-a",
    name: "GPT A",
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
    context: 272000,
  };
  withModels({ codex: [codex] }, () => {
    Assert.deepEqual(
      ZendiaAgents.optionsFor("codex"),
      {
        model: null,
        efforts: [],
        effort: null,
        shownEffort: null,
        contexts: [],
        context: "",
        contextTokens: null,
      },
      "no model picked and no default model: nothing to choose"
    );

    ZendiaAgents.setModel("codex", "gpt-a");
    let options = ZendiaAgents.optionsFor("codex");
    Assert.equal(options.model, codex);
    Assert.deepEqual(options.efforts, codex.efforts);
    Assert.equal(options.effort, null, "none picked: the CLI's settings rule");
    Assert.equal(
      options.shownEffort,
      "medium",
      "the slider rests on the default"
    );
    Assert.equal(options.contextTokens, 272000);
    Assert.deepEqual(options.contexts, []);
    Assert.equal(options.context, "");

    ZendiaAgents.setEffort("codex", "xhigh");
    options = ZendiaAgents.optionsFor("codex");
    Assert.equal(options.effort, "xhigh");
    Assert.equal(options.shownEffort, "xhigh");

    ZendiaAgents.setModel("codex", "gone");
    Assert.deepEqual(
      ZendiaAgents.optionsFor("codex"),
      {
        model: null,
        efforts: [],
        effort: null,
        shownEffort: null,
        contexts: [],
        context: "",
        contextTokens: null,
      },
      "a model that is not listed has no options"
    );
  });
});

add_task(function test_a_saved_effort_the_model_lacks_is_clamped() {
  const model = levels => ({ id: "m", name: "M", efforts: levels });
  const effort = (levels, saved) =>
    withModels({ codex: [model(levels)] }, () => {
      ZendiaAgents.setModel("codex", "m");
      ZendiaAgents.setEffort("codex", saved);
      return ZendiaAgents.optionsFor("codex");
    });
  Assert.equal(effort(["low", "high"], "low").effort, "low", "kept if offered");
  Assert.equal(
    effort(["low", "medium", "high"], "max").effort,
    "high",
    "else high"
  );
  Assert.equal(
    effort(["low", "medium"], "max").effort,
    "medium",
    "else medium"
  );
  Assert.equal(
    effort(["minimal", "low"], "max").effort,
    "minimal",
    "else the first"
  );
  Assert.equal(effort([], "max").effort, null, "no levels, no effort");

  // Without a default, the slider sits in the middle.
  const shown = levels =>
    withModels({ codex: [model(levels)] }, () => {
      ZendiaAgents.setModel("codex", "m");
      return ZendiaAgents.optionsFor("codex").shownEffort;
    });
  Assert.equal(shown(["a", "b", "c", "d"]), "b");
  Assert.equal(shown(["a", "b", "c", "d", "e"]), "c");
  Assert.equal(shown(["a"]), "a");
  Assert.equal(shown([]), null);
});

add_task(function test_an_effort_in_the_model_id_is_always_sent() {
  const agy = {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    effortInId: true,
  };
  withModels({ antigravity: [agy] }, () => {
    ZendiaAgents.setModel("antigravity", "gemini-3.8-flash");
    Assert.equal(
      ZendiaAgents.optionsFor("antigravity").effort,
      "medium",
      "the id needs one, so the default"
    );
    ZendiaAgents.setEffort("antigravity", "high");
    Assert.equal(ZendiaAgents.optionsFor("antigravity").effort, "high");
    ZendiaAgents.setEffort("antigravity", "max");
    Assert.equal(
      ZendiaAgents.optionsFor("antigravity").effort,
      "high",
      "a level it lacks is clamped"
    );
  });
});

add_task(function test_the_default_model_has_options_until_one_is_picked() {
  const opus = {
    id: "opus",
    name: "Opus",
    ...ZENDIA_DRIVERS.claude.defaultModel,
  };
  withModels({ claude: [opus] }, () => {
    let options = ZendiaAgents.optionsFor("claude");
    Assert.equal(options.model, ZENDIA_DRIVERS.claude.defaultModel);
    Assert.deepEqual(options.efforts, [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    Assert.equal(options.effort, null, "nothing is sent unasked");
    Assert.equal(options.shownEffort, "medium");
    Assert.equal(options.contexts.length, 2);
    Assert.equal(options.context, "", "the 1M default");
    Assert.equal(options.contextTokens, null);

    ZendiaAgents.setContext("claude", "200k");
    Assert.equal(ZendiaAgents.optionsFor("claude").context, "200k");
    ZendiaAgents.setContext("claude", "5k");
    Assert.equal(
      ZendiaAgents.optionsFor("claude").context,
      "",
      "a size that is not listed is the default"
    );

    ZendiaAgents.setModel("claude", "opus");
    ZendiaAgents.setEffort("claude", "max");
    options = ZendiaAgents.optionsFor("claude");
    Assert.equal(options.model, opus);
    Assert.equal(options.effort, "max");
  });

  const sized = {
    id: "s",
    name: "S",
    contexts: [
      { id: "a", label: "A" },
      { id: "b", label: "B", default: true },
    ],
  };
  withModels({ codex: [sized] }, () => {
    ZendiaAgents.setModel("codex", "s");
    Assert.equal(ZendiaAgents.optionsFor("codex").context, "b");
    ZendiaAgents.setContext("codex", "a");
    Assert.equal(ZendiaAgents.optionsFor("codex").context, "a");
  });
});

add_task(async function test_a_saved_agy_variant_becomes_model_and_effort() {
  const driver = ZENDIA_DRIVERS.antigravity;
  const original = driver.models;
  driver.models = () =>
    original(async () => ({ stdout: AGY_LISTING, exitCode: 0 }));
  const agent = { id: "antigravity", name: "agy", path: "/bin/true" };
  try {
    ZendiaAgents.setModel("antigravity", "gemini-3.8-flash-low");
    await ZendiaAgents.models(agent, { refresh: true });
    Assert.equal(
      ZendiaAgents.modelFor("antigravity"),
      "gemini-3.8-flash",
      "the model the variant belongs to"
    );
    Assert.equal(ZendiaAgents.effortFor("antigravity"), "low");
    Assert.equal(ZendiaAgents.optionsFor("antigravity").effort, "low");

    // Nothing else is touched: a model that is listed, and a single variant
    // that stayed under its full id.
    ZendiaAgents.setEffort("antigravity", "high");
    await ZendiaAgents.models(agent, { refresh: true });
    Assert.equal(ZendiaAgents.modelFor("antigravity"), "gemini-3.8-flash");
    Assert.equal(ZendiaAgents.effortFor("antigravity"), "high");
    ZendiaAgents.setModel("antigravity", "gpt-oss-120b-medium");
    ZendiaAgents.setEffort("antigravity", "");
    await ZendiaAgents.models(agent, { refresh: true });
    Assert.equal(ZendiaAgents.modelFor("antigravity"), "gpt-oss-120b-medium");
    Assert.equal(ZendiaAgents.effortFor("antigravity"), "");
    ZendiaAgents.setModel("antigravity", "unknown-low");
    await ZendiaAgents.models(agent, { refresh: true });
    Assert.equal(ZendiaAgents.modelFor("antigravity"), "unknown-low");
  } finally {
    driver.models = original;
    clearPicks();
  }
});

add_task(async function test_picture_toolbox_shows_only_pictures() {
  const box = new ZendiaPictureToolbox([
    { name: "challenge.jpg", bytes: new Uint8Array([1, 2, 3]) },
  ]);
  const tools = box.listTools();
  Assert.deepEqual(
    tools.map(tool => tool.name),
    ["picture_view"],
    "No browser tool is offered"
  );
  const seen = await box.callTool("picture_view", { name: "challenge.jpg" });
  Assert.equal(seen.image.mimeType, "image/jpeg");
  Assert.equal(seen.image.data, "AQID");
  const missing = await box.callTool("page_screenshot", {});
  Assert.ok(missing.isError, "Anything else is refused");
  const init = await handleMcpMessage(box, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });
  Assert.ok(
    !/browser|tab/i.test(init.result.instructions),
    "The server tells an isolated session nothing of the browser"
  );
});

add_task(async function test_picture_toolbox_acts_when_it_may() {
  const pressed = [];
  const typedText = [];
  let looks = 0;
  const box = new ZendiaPictureToolbox(
    [{ name: "challenge-area.jpg", bytes: new Uint8Array([1, 2, 3]) }],
    {
      type: async keys => {
        pressed.push(keys);
        return { ok: true, detail: `Pressed ${keys.join(" ")}.` };
      },
      text: async text => {
        typedText.push(text);
        return { ok: true, detail: `Typed ${text}.` };
      },
      look: async () => {
        looks++;
        return {
          name: "challenge-area.jpg",
          bytes: new Uint8Array([9, 9]),
          said: "pick the trucks",
        };
      },
    }
  );
  Assert.deepEqual(
    box.listTools().map(tool => tool.name),
    ["picture_view", "type_keys", "type_text", "look_again"],
    "The acting tools are offered beside the picture"
  );
  const typed = await box.callTool("type_keys", { keys: ["ac", "Enter"] });
  Assert.ok(!typed.isError);
  Assert.deepEqual(
    pressed,
    [["ac", "Enter"]],
    "The keys reach the act handler"
  );
  const text = await box.callTool("type_text", { text: "55PSJ8" });
  Assert.ok(!text.isError);
  Assert.deepEqual(typedText, ["55PSJ8"], "The text reaches the act handler");
  const looked = await box.callTool("look_again", {});
  Assert.equal(looks, 1);
  Assert.equal(looked.image.data, "CQk=", "look_again returns the fresh shot");
  Assert.ok(
    looked.text.includes("pick the trucks"),
    "look_again carries what the task asks now"
  );
  const again = await box.callTool("picture_view", {
    name: "challenge-area.jpg",
  });
  Assert.equal(
    again.image.data,
    "CQk=",
    "the fresh shot replaces what picture_view returns"
  );
  // A wrong name still returns the only picture rather than an error.
  const guessed = await box.callTool("picture_view", { name: "wrong.jpg" });
  Assert.equal(
    guessed.image.data,
    "CQk=",
    "the sole picture is returned anyway"
  );
});

// What kiro leaves behind after it has migrated the agent it was given:
// our own keys, with its permission rules and an upgrade fingerprint of its
// own added. Taken from a profile where it had done it fifty times.
const KIRO_MIGRATED = {
  name: "zendia",
  description: "Works in the browser through zendia only",
  tools: ["@zendia"],
  allowedTools: ["@zendia"],
  includeMcpJson: true,
  permissions: {
    rules: [
      { capability: "mcp", match: ["zendia/*"], effect: "allow" },
      { capability: "fs_read", match: ["./**"], effect: "allow" },
    ],
  },
  kiroUpgrade: { revision: 3, fingerprint: "sha256:a096", source: "sha256:17" },
};

add_task(function test_a_config_an_agent_migrated_still_holds_what_we_asked() {
  const { files } = ZENDIA_DRIVERS.kiro.launch(TURN);
  const [mcp, agent] = files;
  ok(
    holdsJSON(KIRO_MIGRATED, agent.data),
    "kiro's own additions are its own: what we asked for is still in there, " +
      "so the file is left alone and kiro does not migrate it again"
  );
  ok(!holdsJSON(null, agent.data), "nothing on disk is not what we asked for");
  ok(
    !holdsJSON(
      { ...KIRO_MIGRATED, allowedTools: ["@zendia", "@shell"] },
      agent.data
    ),
    "a tool we did not allow is a config to write again"
  );
  ok(
    !holdsJSON({ ...KIRO_MIGRATED, includeMcpJson: false }, agent.data),
    "a value of ours that was changed is a config to write again"
  );
  ok(holdsJSON(mcp.data, mcp.data), "the same config holds itself");
  ok(
    !holdsJSON(
      {
        mcpServers: {
          zendia: {
            ...mcp.data.mcpServers.zendia,
            url: "http://127.0.0.1:1/mcp",
          },
        },
      },
      mcp.data
    ),
    "a stale address — the browser's port of a run before — is written again"
  );
});

add_task(function test_what_a_config_holds_is_read_to_the_leaves() {
  ok(holdsJSON({ a: 1, b: 2 }, { a: 1 }), "more of its own is fine");
  ok(!holdsJSON({ a: 1 }, { a: 1, b: 2 }), "less than we asked for is not");
  ok(!holdsJSON({ a: { b: 1 } }, { a: { b: 2 } }), "a deep value counts");
  ok(
    holdsJSON({ a: { b: 1, c: 2 } }, { a: { b: 1 } }),
    "and so does a deep extra"
  );
  ok(!holdsJSON({ a: ["x"] }, { a: ["x", "y"] }), "a list is all of it");
  ok(!holdsJSON({ a: "1" }, { a: 1 }), "a string is not a number");
  ok(!holdsJSON([1, 2], { 0: 1, 1: 2 }), "a list is not an object");
  ok(holdsJSON(null, null), "nothing is nothing");
});

add_task(async function test_a_version_is_only_the_builds_it_was_read_from() {
  const path = PathUtils.join(
    PathUtils.tempDir,
    `zendia-stamp-${Date.now()}.bin`
  );
  Assert.equal(await stampOf(path), null, "nothing there has no stamp");
  await IOUtils.writeUTF8(path, "one");
  const first = await stampOf(path);
  ok(!!first, "a binary on disk has one");
  Assert.equal(await stampOf(path), first, "the same binary keeps it");
  await IOUtils.writeUTF8(path, "a longer build than before");
  Assert.notEqual(
    await stampOf(path),
    first,
    "an upgrade in place keeps the path and moves the stamp, which is what " +
      "tells the cache its version belongs to a build that is gone"
  );
  await IOUtils.remove(path);
  Assert.equal(await stampOf(path), null);
});

// The cache is read once per session, so this is the one task that may read
// it: it plants both cases at once, a build that is still the build the
// version was read from and one that has been replaced since.
add_task(async function test_the_cache_keeps_a_version_only_for_its_build() {
  const dir = PathUtils.join(do_get_profile().path, "zendia", "agent");
  await IOUtils.makeDirectory(dir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const binary = async name => {
    const path = PathUtils.join(dir, name);
    await IOUtils.writeUTF8(path, "#!/bin/sh\necho 9.9.9\n");
    await IOUtils.setPermissions(path, 0o755);
    return path;
  };
  const same = await binary("agent-same");
  const upgraded = await binary("agent-upgraded");
  await IOUtils.writeJSON(PathUtils.join(dir, "detect-cache.json"), {
    agents: {
      cursor: { path: same, version: "1.1.1", stamp: await stampOf(same) },
      kiro: { path: upgraded, version: "2.2.2", stamp: "0:0" },
    },
  });

  const found = await ZendiaAgentDetect.detect();
  const of = id => found.find(agent => agent.id == id);
  Assert.equal(
    of("cursor").version,
    "1.1.1",
    "the binary is the one the version was read from, so it still stands"
  );
  Assert.equal(of("cursor").path, same, "and it is still where it was");
  Assert.equal(
    of("kiro").version,
    null,
    "an upgrade in place keeps the path and moves the stamp: the version it " +
      "had is not the version it has, and is read again rather than told"
  );
  Assert.equal(of("kiro").path, upgraded, "the path it found is still good");
});
