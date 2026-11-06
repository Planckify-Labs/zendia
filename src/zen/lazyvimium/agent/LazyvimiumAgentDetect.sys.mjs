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
 * @property {string[]} [winDirs] Windows install directories to try after
 *   PATH, with %VAR% for environment variables.
 * @property {string} install How to install it, shown when the agent is
 *   missing. Nothing here ever runs it.
 * @property {string} [installWin] The same on Windows.
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
    winDirs: ["~\\.local\\bin", "~\\.claude\\local"],
    installWin: "irm https://claude.ai/install.ps1 | iex",
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
    winDirs: [
      "%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin",
      "%CODEX_INSTALL_DIR%",
    ],
    installWin: "npm install -g @openai/codex",
    install: "npm install -g @openai/codex",
  },
  {
    id: "cursor",
    name: "Cursor",
    bin: "cursor-agent",
    paths: ["~/.local/bin/cursor-agent", "~/.cursor/bin/cursor-agent"],
    winDirs: ["%LOCALAPPDATA%\\cursor-agent"],
    installWin: "irm 'https://cursor.com/install?win32=true' | iex",
    install: "curl https://cursor.com/install -fsS | bash",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    bin: "agy",
    paths: ["~/.local/bin/agy", "/opt/homebrew/bin/agy", "/usr/local/bin/agy"],
    winDirs: ["%LOCALAPPDATA%\\agy\\bin"],
    installWin: "irm https://antigravity.google/cli/install.ps1 | iex",
    install: "Install the Antigravity CLI (agy) from antigravity.google",
  },
  {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    paths: ["~/.opencode/bin/opencode", "/opt/homebrew/bin/opencode"],
    winDirs: [
      "~\\.opencode\\bin",
      "%LOCALAPPDATA%\\Programs\\opencode",
      "%LOCALAPPDATA%\\opencode",
    ],
    installWin: "npm install -g opencode-ai",
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
    winDirs: ["%ProgramFiles%\\Kiro-Cli", "%LOCALAPPDATA%\\Programs\\Kiro-Cli"],
    installWin: "irm https://cli.kiro.dev/install.ps1 | iex",
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
  "~/.yarn/bin",
  "~/.config/yarn/global/node_modules/.bin",
  "~/.local/share/mise/shims",
  "~/.asdf/shims",
  "~/.nix-profile/bin",
  "/nix/var/nix/profiles/default/bin",
  "/home/linuxbrew/.linuxbrew/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  // Where the tools put theirs when told to.
  "%BUN_INSTALL%/bin",
  "%PNPM_HOME%",
  "%NPM_CONFIG_PREFIX%/bin",
  "%VOLTA_HOME%/bin",
  "%MISE_DATA_DIR%/shims",
  "%ASDF_DATA_DIR%/shims",
];

// The same on Windows: where npm, pnpm, bun, volta, scoop, chocolatey and
// winget put the shims and executables they install. The agents' own
// installers add theirs (winDirs above).
const WINDOWS_TOOLCHAIN_DIRS = [
  "%APPDATA%\\npm",
  "~\\.local\\bin",
  "~\\.bun\\bin",
  "%LOCALAPPDATA%\\pnpm",
  "%PNPM_HOME%",
  "%VOLTA_HOME%\\bin",
  "%LOCALAPPDATA%\\Volta\\bin",
  "%LOCALAPPDATA%\\Yarn\\bin",
  "%LOCALAPPDATA%\\Microsoft\\WinGet\\Links",
  "%BUN_INSTALL%\\bin",
  "%NPM_CONFIG_PREFIX%",
  "%SCOOP%\\shims",
  "~\\scoop\\shims",
  "%SCOOP_GLOBAL%\\shims",
  "%ProgramData%\\scoop\\shims",
  "%ProgramFiles%\\WinGet\\Links",
  "%LOCALAPPDATA%\\mise\\shims",
  "%MISE_DATA_DIR%\\shims",
  "%ChocolateyInstall%\\bin",
  "%ProgramData%\\chocolatey\\bin",
  "%ProgramFiles%\\nodejs",
  "%NVM_SYMLINK%",
];

// What a command can be on Windows, in the order tried within a directory:
// a real executable before the .cmd shim that npm writes. Nothing else can
// be started without a shell.
const WINDOWS_EXTENSIONS = [".exe", ".cmd", ".bat"];

// The package managers the agents' docs install with, and the command that
// prints where each puts global executables. npm prints a prefix (the
// executables sit in it on Windows, in its bin elsewhere); the others print
// the directory itself.
const PACKAGE_MANAGERS = [
  { bin: "npm", args: ["config", "get", "prefix"], prefix: true },
  { bin: "pnpm", args: ["bin", "-g"], prefix: false },
  { bin: "yarn", args: ["global", "bin"], prefix: false },
  { bin: "bun", args: ["pm", "bin", "-g"], prefix: false },
];
const MANAGER_TIMEOUT_MS = 4000;

const BEGIN_MARKER = "__LAZYVIMIUM_SHELL_ENV_BEGIN__";
const END_MARKER = "__LAZYVIMIUM_SHELL_ENV_END__";
const SHELL_TIMEOUT_MS = 5000;
const VERSION_TIMEOUT_MS = 5000;
const EXIT_GRACE_MS = 1000;

function isWindows() {
  return Services.appinfo.OS == "WINNT";
}

function home() {
  return Services.dirsvc.get("Home", Ci.nsIFile).path;
}

/**
 * Expand a leading ~ and, on Windows, %VAR% references.
 *
 * @param {string} path
 * @param {(name: string) => string|null} [getenv] Where variables come from.
 * @returns {string|null} Null when a variable it needs is not set.
 */
export function expand(path, getenv = name => Services.env.get(name) || null) {
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return PathUtils.join(home(), ...path.slice(2).split(/[\\/]/));
  }
  let missing = false;
  const expanded = path.replace(/%([A-Za-z_][^%\\/]*)%/g, (match, name) => {
    const value = getenv(name);
    if (value === null || value === "") {
      missing = true;
    }
    return value ?? match;
  });
  return missing ? null : expanded;
}

/**
 * Whether `path` starts at a drive or a share, which is all a PATH entry
 * can be to count on Windows (relative ones and "%UNSET%" are dropped).
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isWindowsAbsolute(path) {
  return /^([A-Za-z]:[\\/]|\\\\)/.test(path);
}

/**
 * The directories of a Windows PATH value, expanded.
 *
 * @param {string|null|undefined} value
 * @param {(name: string) => string|null} [getenv]
 * @returns {string[]}
 */
export function parseWindowsPath(value, getenv) {
  return (value ?? "")
    .split(";")
    .map(dir => dir.trim().replace(/^"(.*)"$/, "$1"))
    .map(dir => (dir ? expand(dir, getenv) : null))
    .filter(dir => dir && isWindowsAbsolute(dir));
}

/**
 * The files that could be `bin` in `dir`, in the order to try them.
 *
 * @param {string} dir
 * @param {string} bin
 * @param {boolean} windows
 * @returns {string[]}
 */
export function candidatesIn(dir, bin, windows) {
  return windows
    ? WINDOWS_EXTENSIONS.map(
        ext => `${dir.replace(/[\\/]+$/, "")}\\${bin}${ext}`
      )
    : [PathUtils.join(dir, bin)];
}

/**
 * The global bin directory a package manager printed.
 *
 * @param {string} output What the manager printed.
 * @param {boolean} prefix Whether it printed npm's prefix, not the directory.
 * @param {boolean} windows
 * @returns {string|null} Null when the last line is not a directory (yarn 2+
 *   has no `global`, and prints an error).
 */
export function parseManagerDir(output, prefix, windows) {
  const line = output
    .split("\n")
    .map(text => text.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean)
    .pop();
  if (!line || !(windows ? isWindowsAbsolute(line) : line.startsWith("/"))) {
    return null;
  }
  return prefix && !windows ? `${line.replace(/\/+$/, "")}/bin` : line;
}

/**
 * The environment entries that set PATH for a child, without leaving the
 * parent's differently-cased "Path" beside it: Windows treats the two as one
 * variable and a child would get whichever it reads first.
 *
 * @param {string} path
 * @returns {Record<string, string|null>}
 */
export function pathEnvironment(path) {
  const environment = { PATH: path };
  if (isWindows()) {
    for (const name of Object.keys(lazy.Subprocess.getEnvironment())) {
      if (/^path$/i.test(name) && name != "PATH") {
        environment[name] = null;
      }
    }
  }
  return environment;
}

// PATH as the registry holds it (user entries after the machine's, like the
// shell builds it). A browser keeps the PATH it started with, so an agent
// installed since is on the registry's PATH only.
function registryPath() {
  const read = (root, subkey) => {
    try {
      const key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
        Ci.nsIWindowsRegKey
      );
      key.open(root, subkey, Ci.nsIWindowsRegKey.ACCESS_READ);
      try {
        return key.readStringValue("Path");
      } finally {
        key.close();
      }
    } catch {
      return "";
    }
  };
  return [
    read(
      Ci.nsIWindowsRegKey.ROOT_KEY_LOCAL_MACHINE,
      "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"
    ),
    read(Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER, "Environment"),
  ].join(";");
}

// The prefix npm installs global packages to when ~/.npmrc moves it.
async function npmPrefix() {
  try {
    const rc = await IOUtils.readUTF8(PathUtils.join(home(), ".npmrc"));
    const line = rc.match(/^\s*prefix\s*=\s*(.+?)\s*$/m);
    return line ? expand(line[1].replace(/^"(.*)"$/, "$1")) : null;
  } catch {
    return null;
  }
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
      environment: environment.PATH
        ? { ...environment, ...pathEnvironment(environment.PATH) }
        : environment,
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
    if (info.type != "regular") {
      return false;
    }
    // Windows has no execute bit; what runs is told by its extension.
    return isWindows()
      ? WINDOWS_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext))
      : !!(info.permissions & 0o111);
  } catch {
    return false;
  }
}

// The agent's entry with the install command of this system.
function forThisSystem(agent) {
  return isWindows() && agent.installWin
    ? { ...agent, install: agent.installWin }
    : agent;
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
  /** @type {Promise<string[]>|null} Global bin directories the managers report. */
  #managers = null;

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
    if (isWindows()) {
      return this.#windowsDirs().join(";");
    }
    const dirs = [
      ...((await this.shellPath()) ?? "").split(":"),
      ...(Services.env.get("PATH") ?? "").split(":"),
      ...TOOLCHAIN_DIRS.map(dir => expand(dir)),
    ];
    return [...new Set(dirs.filter(dir => dir?.startsWith("/")))].join(":");
  }

  // This process's PATH, then the registry's (which has what was installed
  // since the browser started), then the usual global install directories.
  #windowsDirs() {
    const dirs = [
      ...parseWindowsPath(Services.env.get("PATH")),
      ...parseWindowsPath(registryPath()),
      ...WINDOWS_TOOLCHAIN_DIRS.map(dir => expand(dir)).filter(Boolean),
    ];
    const seen = new Set();
    return dirs.filter(dir => {
      // Windows paths are not case sensitive, and trailing slashes vary.
      const key = dir.toLowerCase().replace(/[\\/]+$/, "");
      return !seen.has(key) && seen.add(key);
    });
  }

  /**
   * Where an agent's executable is, if it is installed.
   *
   * @param {LazyvimiumAgentInfo} agent
   * @returns {Promise<string|null>}
   */
  async resolve(agent) {
    const windows = isWindows();
    const dirs = (await this.childPath()).split(windows ? ";" : ":");
    const found = await this.#firstIn(
      windows
        ? [
            ...dirs,
            ...(agent.winDirs ?? []).map(dir => expand(dir)).filter(Boolean),
            ...(await this.#windowsNodeBins()),
          ]
        : [
            ...dirs,
            ...agent.paths
              .map(path => expand(path))
              .filter(Boolean)
              .map(path => PathUtils.parent(path)),
            ...(await this.#nvmBins()),
          ],
      agent.bin
    );
    if (found) {
      return found;
    }
    // Not in any usual place: ask the package managers where their global
    // installs go (a prefix set in an rc file or an environment variable
    // lands anywhere), and look through winget's package folders.
    return this.#firstIn(
      [
        ...(await this.#managerDirs(dirs)),
        ...(windows ? await this.#wingetDirs(agent) : []),
      ],
      agent.bin
    );
  }

  async #firstIn(dirs, bin) {
    const candidates = new Set(
      dirs.flatMap(dir => candidatesIn(dir, bin, isWindows()))
    );
    for (const candidate of candidates) {
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * The global bin directories npm, pnpm, yarn and bun report, which the
   * agents installed with them land in. Asked once per session, and only
   * when an agent was not found anywhere else.
   *
   * @param {string[]} dirs Where to find the managers themselves.
   * @returns {Promise<string[]>}
   */
  #managerDirs(dirs) {
    this.#managers ??= Promise.all(
      PACKAGE_MANAGERS.map(async manager => {
        const executable = await this.#firstIn(dirs, manager.bin);
        if (!executable) {
          return null;
        }
        const { stdout } = await runForOutput(executable, manager.args, {
          ms: MANAGER_TIMEOUT_MS,
          environment: { PATH: dirs.join(isWindows() ? ";" : ":") },
        });
        return parseManagerDir(stdout, manager.prefix, isWindows());
      })
    ).then(list => list.filter(Boolean));
    return this.#managers;
  }

  // winget unpacks portable packages into one folder each; its Links
  // directory only holds the ones that registered a command.
  async #wingetDirs(agent) {
    const root = expand("%LOCALAPPDATA%\\Microsoft\\WinGet\\Packages");
    try {
      const names = [agent.id, agent.bin].map(name => name.toLowerCase());
      return (await IOUtils.getChildren(root)).filter(dir => {
        const name = PathUtils.filename(dir).toLowerCase();
        return names.some(wanted => name.includes(wanted));
      });
    } catch {
      return [];
    }
  }

  // nvm's per-version bin directories, newest first.
  async #nvmBins() {
    return this.#versionDirs("~/.nvm/versions/node", "bin");
  }

  // Where npm puts global packages when it is not on PATH: a prefix set in
  // ~/.npmrc, and the per-version directories of nvm-windows (the global
  // packages sit in the version directory itself) and fnm.
  async #windowsNodeBins() {
    const prefix = await npmPrefix();
    return [
      ...(prefix ? [prefix] : []),
      ...(await this.#versionDirs("%NVM_HOME%")),
      ...(await this.#versionDirs("%APPDATA%\\nvm")),
      ...(await this.#versionDirs(
        "%APPDATA%\\fnm\\node-versions",
        "installation"
      )),
      ...(await this.#versionDirs(
        "%LOCALAPPDATA%\\fnm\\node-versions",
        "installation"
      )),
    ];
  }

  async #versionDirs(root, sub = null) {
    const expanded = expand(root);
    if (!expanded) {
      return [];
    }
    try {
      const versions = await IOUtils.getChildren(expanded);
      return versions
        .sort((a, b) =>
          PathUtils.filename(b).localeCompare(
            PathUtils.filename(a),
            undefined,
            {
              numeric: true,
            }
          )
        )
        .map(dir => (sub ? PathUtils.join(dir, sub) : dir));
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
            ...forThisSystem(agent),
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
          ...forThisSystem(agent),
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
