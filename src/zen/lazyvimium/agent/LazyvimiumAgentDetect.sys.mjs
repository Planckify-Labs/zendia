// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Finding the coding agents installed on this machine, after zeron's
// harness crate (shell_env.rs, executable.rs). A browser started from the
// dock or a desktop file never runs the user's shell init, so its PATH misses
// nvm, pnpm, bun, ~/.local/bin and the rest. The only lookup that works for
// any setup is asking the user's own login shell for its PATH once, and then
// trying the places the agents' installers use.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

/**
 * @typedef {object} LazyvimiumAgentInfo
 * @property {string} id The driver's key and the lazyvimium.agent.default
 *   value.
 * @property {string} name As the user knows it.
 * @property {string} bin The executable to look for.
 * @property {string[]} paths Install locations to try after PATH, with ~
 *   for the home directory.
 * @property {string} install How to install it, shown when the agent is
 *   missing. Nothing here ever runs it.
 */

/** @type {LazyvimiumAgentInfo[]} In the order offered to the user. */
export const LAZYVIMIUM_AGENTS = [
  {
    id: "claude",
    name: "Claude Code",
    bin: "claude",
    paths: [
      "~/.claude/local/claude",
      "~/.local/bin/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ],
    install: "curl -fsSL https://claude.ai/install.sh | bash",
  },
  {
    id: "codex",
    name: "Codex",
    bin: "codex",
    paths: [
      "~/.local/bin/codex",
      "~/.codex/bin/codex",
      "~/.npm-global/bin/codex",
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ],
    install: "npm install -g @openai/codex",
  },
  {
    id: "cursor",
    name: "Cursor",
    bin: "cursor-agent",
    paths: ["~/.local/bin/cursor-agent", "~/.cursor/bin/cursor-agent"],
    install: "curl https://cursor.com/install -fsS | bash",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    bin: "agy",
    paths: ["~/.local/bin/agy", "/opt/homebrew/bin/agy", "/usr/local/bin/agy"],
    install: "Install the Antigravity CLI (agy) from antigravity.google",
  },
  {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    paths: ["~/.opencode/bin/opencode", "/opt/homebrew/bin/opencode"],
    install: "curl -fsSL https://opencode.ai/install | bash",
  },
  {
    id: "kiro",
    name: "Kiro",
    bin: "kiro-cli",
    paths: [
      "~/.local/bin/kiro-cli",
      "~/.kiro/bin/kiro-cli",
      "/opt/homebrew/bin/kiro-cli",
      "/usr/local/bin/kiro-cli",
    ],
    install: "curl -fsSL https://cli.kiro.dev/install | bash",
  },
];

// Global install directories of the Node toolchains, which npm-installed
// agents land in.
const TOOLCHAIN_DIRS = [
  "~/.local/bin",
  "~/.bun/bin",
  "~/.volta/bin",
  "~/.npm-global/bin",
  "~/.local/share/pnpm",
  "~/Library/pnpm",
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

const BEGIN_MARKER = "__LAZYVIMIUM_SHELL_ENV_BEGIN__";
const END_MARKER = "__LAZYVIMIUM_SHELL_ENV_END__";
const SHELL_TIMEOUT_MS = 5000;
const VERSION_TIMEOUT_MS = 5000;
const EXIT_GRACE_MS = 1000;

function home() {
  return Services.dirsvc.get("Home", Ci.nsIFile).path;
}

function expand(path) {
  return path.startsWith("~/")
    ? PathUtils.join(home(), ...path.slice(2).split("/"))
    : path;
}

function timeout(ms) {
  return new Promise(resolve => lazy.setTimeout(resolve, ms, null));
}

/**
 * Run a command and collect its output, killing it after `ms`.
 *
 * @param {string} command An absolute path.
 * @param {string[]} args
 * @param {object} [options]
 * @param {number} [options.ms]
 * @param {Record<string, string>} [options.environment]
 * @param {string} [options.until] Stop reading once stdout holds this.
 * @returns {Promise<{stdout: string, exitCode: number|null}>}
 */
export async function runForOutput(
  command,
  args,
  { ms = VERSION_TIMEOUT_MS, environment = {}, until = null } = {}
) {
  let proc;
  try {
    proc = await lazy.Subprocess.call({
      command,
      arguments: args,
      environment,
      environmentAppend: true,
      stderr: "pipe",
    });
  } catch {
    return { stdout: "", exitCode: null };
  }
  proc.stdin.close().catch(() => {});
  let stdout = "";
  const read = (async () => {
    let chunk;
    while ((chunk = await proc.stdout.readString())) {
      stdout += chunk;
      if (until && stdout.includes(until)) {
        return null;
      }
    }
    return (await proc.wait()).exitCode;
  })().catch(() => null);
  // Drain stderr so a chatty shell never blocks on a full pipe.
  (async () => {
    while (await proc.stderr.readString()) {
      // Discarded.
    }
  })().catch(() => {});
  let exitCode = await Promise.race([read, timeout(ms)]);
  if (exitCode === null && until && stdout.includes(until)) {
    // Done reading; a shell that printed everything usually exits next.
    exitCode = await Promise.race([
      proc.wait().then(
        ({ exitCode: code }) => code,
        () => null
      ),
      timeout(EXIT_GRACE_MS),
    ]);
  }
  if (exitCode === null) {
    // Hung. Subprocess races a kill against an exit it has not seen yet,
    // so only the stuck get one.
    proc.kill(0).catch(() => {});
  }
  return { stdout, exitCode };
}

/**
 * Pull PATH out of `env` output printed between the markers.
 *
 * @param {string} output
 * @returns {string|null}
 */
export function parseShellPath(output) {
  const start = output.indexOf(BEGIN_MARKER);
  const end = output.indexOf(END_MARKER, start + 1);
  if (start == -1 || end == -1) {
    return null;
  }
  for (const line of output.slice(start, end).split("\n")) {
    if (line.startsWith("PATH=")) {
      const path = line.slice("PATH=".length).trim();
      return path || null;
    }
  }
  return null;
}

/**
 * Pull the first version number out of `--version` output.
 *
 * @param {string} output
 * @returns {string|null}
 */
export function parseVersion(output) {
  return output.match(/\d+\.\d+(\.\d+)?(-[\w.]+)?/)?.[0] ?? null;
}

// What the last scan found, kept between sessions so the first answer of a
// session costs a few stat calls, not a login shell and a --version run per
// agent.
function cachePath() {
  return PathUtils.join(
    PathUtils.profileDir,
    "lazyvimium",
    "agent",
    "detect-cache.json"
  );
}

async function isExecutable(path) {
  try {
    const info = await IOUtils.stat(path);
    return info.type == "regular" && !!(info.permissions & 0o111);
  } catch {
    return false;
  }
}

class LazyvimiumAgentDetector {
  /** @type {Promise<string|null>|null} */
  #shellPath = null;
  /** @type {Promise<object[]>|null} */
  #detected = null;
  /** @type {object[]|null} The last answer, for callers that cannot wait. */
  #last = null;
  /** @type {Map<string, string>} Version by executable path. */
  #versions = new Map();

  /**
   * The PATH the user's login shell reports, asked once per session: as an
   * interactive login shell first, since nvm and friends load in rc files,
   * then as a plain login shell for rc files that hang when interactive.
   *
   * @returns {Promise<string|null>}
   */
  shellPath() {
    this.#shellPath ??= (async () => {
      if (Services.appinfo.OS == "WINNT") {
        return null;
      }
      const env = Services.env;
      const shells = [env.get("SHELL"), "/bin/zsh", "/bin/bash", "/bin/sh"];
      const script = `echo ${BEGIN_MARKER}; env; echo ${END_MARKER}`;
      for (const shell of new Set(shells.filter(Boolean))) {
        if (!(await IOUtils.exists(shell))) {
          continue;
        }
        const name = PathUtils.filename(shell);
        const flagSets =
          name == "fish"
            ? [["-l", "-c"]]
            : [
                ["-l", "-i", "-c"],
                ["-l", "-c"],
              ];
        for (const flags of flagSets) {
          const { stdout } = await runForOutput(shell, [...flags, script], {
            ms: SHELL_TIMEOUT_MS,
            environment: {
              LAZYVIMIUM_RESOLVING_ENVIRONMENT: "1",
              TERM: "dumb",
            },
            until: END_MARKER,
          });
          const path = parseShellPath(stdout);
          if (path) {
            return path;
          }
        }
      }
      return null;
    })();
    return this.#shellPath;
  }

  /**
   * The PATH agents are started with: the login shell's, then this
   * process's, then the toolchain directories.
   *
   * @returns {Promise<string>}
   */
  async childPath() {
    const dirs = [
      ...((await this.shellPath()) ?? "").split(":"),
      ...(Services.env.get("PATH") ?? "").split(":"),
      ...TOOLCHAIN_DIRS.map(expand),
    ];
    return [...new Set(dirs.filter(dir => dir.startsWith("/")))].join(":");
  }

  /**
   * Where an agent's executable is, if it is installed.
   *
   * @param {LazyvimiumAgentInfo} agent
   * @returns {Promise<string|null>}
   */
  async resolve(agent) {
    const dirs = (await this.childPath()).split(":");
    const candidates = [
      ...dirs.map(dir => PathUtils.join(dir, agent.bin)),
      ...agent.paths.map(expand),
      ...(await this.#nvmBins()).map(dir => PathUtils.join(dir, agent.bin)),
    ];
    for (const candidate of new Set(candidates)) {
      try {
        const info = await IOUtils.stat(candidate);
        if (info.type == "regular" && info.permissions & 0o111) {
          return candidate;
        }
      } catch {
        // Not there.
      }
    }
    return null;
  }

  // nvm's per-version bin directories, newest first.
  async #nvmBins() {
    const root = expand("~/.nvm/versions/node");
    try {
      const versions = await IOUtils.getChildren(root);
      return versions
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map(dir => PathUtils.join(dir, "bin"));
    } catch {
      return [];
    }
  }

  /**
   * Every known agent with where it is installed, if it is. The first call
   * of a session answers from the last session's scan when that still holds,
   * and looks again behind it; a version that is not known yet fills in
   * when its --version run ends.
   *
   * @param {object} [options]
   * @param {boolean} [options.refresh] Look again instead of using the last
   *   answer, e.g. after the user installed one. Costs a stat per place,
   *   not a process.
   * @returns {Promise<Array<LazyvimiumAgentInfo & {path: string|null, version: string|null}>>}
   */
  detect({ refresh = false } = {}) {
    if (refresh) {
      this.#detected = this.#scan();
    }
    this.#detected ??= this.#fromCache();
    return this.#detected;
  }

  /**
   * The last answer, at once; null before the first one.
   *
   * @returns {Array<LazyvimiumAgentInfo & {path: string|null, version: string|null}>|null}
   */
  get known() {
    return this.#last;
  }

  async #fromCache() {
    let cached = null;
    try {
      cached = (await IOUtils.readJSON(cachePath()))?.agents ?? null;
    } catch {
      // No cache yet.
    }
    if (cached) {
      const list = await Promise.all(
        LAZYVIMIUM_AGENTS.map(async agent => {
          const entry = cached[agent.id];
          const found = entry?.path && (await isExecutable(entry.path));
          return {
            ...agent,
            path: found ? entry.path : null,
            version: found ? (entry.version ?? null) : null,
          };
        })
      );
      if (list.some(agent => agent.path)) {
        this.#last = list;
        for (const agent of list) {
          if (agent.version) {
            this.#versions.set(agent.path, agent.version);
          }
        }
        // Look again behind the answer: an agent installed since, or moved.
        this.#detected = this.#scan();
        return list;
      }
    }
    return this.#scan();
  }

  async #scan() {
    const path = await this.childPath();
    const list = await Promise.all(
      LAZYVIMIUM_AGENTS.map(async agent => {
        const executable = await this.resolve(agent);
        return {
          ...agent,
          path: executable,
          version: executable ? (this.#versions.get(executable) ?? null) : null,
        };
      })
    );
    this.#last = list;
    this.#fillVersions(list, path);
    return list;
  }

  // The --version runs of the executables whose version is not known, in
  // the background; each fills in its entry when it ends.
  async #fillVersions(list, path) {
    await Promise.all(
      list.map(async agent => {
        if (!agent.path || agent.version) {
          return;
        }
        const { stdout } = await runForOutput(agent.path, ["--version"], {
          environment: { PATH: path },
        });
        agent.version = parseVersion(stdout);
        if (agent.version) {
          this.#versions.set(agent.path, agent.version);
        }
      })
    );
    await this.#saveCache(list);
  }

  async #saveCache(list) {
    const agents = {};
    for (const agent of list) {
      if (agent.path) {
        agents[agent.id] = { path: agent.path, version: agent.version };
      }
    }
    try {
      await IOUtils.makeDirectory(PathUtils.parent(cachePath()), {
        createAncestors: true,
        ignoreExisting: true,
      });
      await IOUtils.writeJSON(cachePath(), { agents });
    } catch {
      // A cache that is not written is only a slower next start.
    }
  }

  /**
   * @returns {Promise<object[]>} The installed agents only.
   */
  async installed() {
    return (await this.detect()).filter(agent => agent.path);
  }
}

export const LazyvimiumAgentDetect = new LazyvimiumAgentDetector();
