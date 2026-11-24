// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The onboarding. Built around Zendia's six-cell Voronoi logo and morphing
// mascot, rendered entirely in crisp 2D SVG and spring-physics CSS motion.
//
// Opens on the Living Emblem start page, then walks through six chapters —
// each paired with one of Zendia's six vim mode cells and its own live 2D
// motion preview. Enter moves on and Backspace goes back.
//
// Everything that touches the browser goes through `host`, the object
// ZenWelcome.mjs hands over (dev/host.js stands in for it on the dev page).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_COLORS, MODE_META, makeTheme } from "./motion.js";
import { AgentScene2D } from "./scenes/AgentScene2D.jsx";
import { AppsScene2D } from "./scenes/AppsScene2D.jsx";
import { GoScene2D } from "./scenes/GoScene2D.jsx";
import { MoveInScene2D } from "./scenes/MoveInScene2D.jsx";
import { ShieldScene2D } from "./scenes/ShieldScene2D.jsx";
import { Stage2D } from "./scenes/Stage2D.jsx";
import { StartScene2D } from "./scenes/StartScene2D.jsx";
import { VimScene2D } from "./scenes/VimScene2D.jsx";
import { sound } from "./sound.js";
import { Key, Mascot, Option, T, YesNo } from "./ui.jsx";

function SoundToggle({ muted, onToggle, className = "" }) {
  return (
    <button
      type="button"
      id="zen-welcome-sound"
      className={`z2d-sound-toggle ${className}`}
      onClick={onToggle}
      aria-label={muted ? "Unmute onboarding audio" : "Mute onboarding audio"}
      title={muted ? "Sound off — click to unmute" : "Sound on — click to mute"}
    >
      {muted ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 5a10 10 0 0 1 0 14" />
        </svg>
      )}
    </button>
  );
}

// Each chapter embodies one of the logo's six Voronoi mode cells.
const CHAPTERS = [
  { id: "keys", pose: "n", looping: true },
  { id: "agent", pose: "e", looping: true },
  { id: "shield", pose: "t", looping: true },
  { id: "move-in", pose: "l", looping: true },
  { id: "apps", pose: "i", skip: true, looping: false },
  { id: "go", pose: "v", looping: false },
];

// The keys the vim mode preview plays, in the order it plays them.
const VIM_KEYS = [
  ["j  k", "zendia-welcome-key-scroll"],
  ["⇧J  ⇧K", "zendia-welcome-key-next-tab"],
  ["Space", "zendia-welcome-key-leader"],
  ["Space e", "zendia-welcome-key-explorer"],
  ["Space a a", "zendia-welcome-key-agent"],
  ["Esc", "zendia-welcome-key-escape"],
];

/** What an async call of the host returned, or null while it runs. */
function useHostData(load) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    load()
      .then(value => live && setData(value))
      .catch(error => {
        console.error(error);
        live && setData(undefined);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return data;
}

function AgentChoices({ agents, answer, setAnswer }) {
  if (agents === null) {
    return <T as="p" id="zendia-welcome-agent-looking" className="zen-welcome-status" />;
  }
  const { installed = [], missing = [] } = agents ?? {};
  return (
    <>
      {!installed.length && <T as="p" id="zendia-welcome-agent-none" className="zen-welcome-status" />}
      <div className="zen-welcome-list" role="radiogroup">
        {installed.map(agent => (
          <Option
            key={agent.id}
            id={`zen-welcome-agent-${agent.id}`}
            group="zen-welcome-zendia-agents"
            text={agent.name}
            icon={agent.icon}
            checked={answer == agent.id}
            onChoose={() => setAnswer(agent.id)}
            inputProps={{ value: agent.id }}
          >
            <span className="zen-welcome-version">{agent.version ?? ""}</span>
          </Option>
        ))}
      </div>
      {!!missing.length && (
        <div className="zen-welcome-missing">
          <T id="zendia-welcome-agent-missing" as="h2" />
          {missing.map(agent => (
            <div key={agent.name} className="zen-welcome-missing-row">
              {agent.icon && (
                <span className="zen-welcome-plate" aria-hidden="true">
                  <img src={agent.icon} alt="" />
                </span>
              )}
              <strong>{agent.name}</strong>
              <code>{agent.install}</code>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Moving in: three focused groups; touching or focusing any group switches
// the live 2D preview to illustrate that decision.
function MoveInChoices({ sources, engines, answers, answer, host, focus, setFocus }) {
  const imported = answers.import;
  return (
    <>
      <fieldset
        data-active={focus == "import" ? "" : undefined}
        onFocus={() => setFocus("import")}
        onPointerDown={() => setFocus("import")}
      >
        <T as="legend" id="zendia-welcome-import-heading" />
        <div className="zen-welcome-fieldset-items">
          <Option
            id="zen-welcome-import-no"
            group="zen-welcome-import"
            l10n="zendia-welcome-import-none"
            checked={imported.source < 0}
            onChoose={() => answer("import", { ...imported, source: -1 })}
          />
          {(sources ?? []).map((source, index) => (
            <div className="zen-welcome-import-source" key={source.key} expanded={imported.source == index ? "" : undefined}>
              <Option
                id={`zen-welcome-import-${index}`}
                group="zen-welcome-import"
                text={source.name}
                icon={source.image}
                checked={imported.source == index}
                onChoose={() => answer("import", { ...imported, source: index })}
                inputProps={{ "data-source-index": index, "data-source-key": source.key }}
              />
              {source.profiles.length > 1 && imported.source == index && (
                <div className="zen-welcome-import-profiles">
                  {source.profiles.map((profile, profileIndex) => (
                    <label className="zen-welcome-import-profile" key={profileIndex}>
                      <input
                        type="radio"
                        name={`zen-welcome-import-profile-${index}`}
                        value={profileIndex}
                        checked={(imported.profiles[index] ?? 0) == profileIndex}
                        onChange={() =>
                          answer("import", { ...imported, profiles: { ...imported.profiles, [index]: profileIndex } })
                        }
                      />
                      <span className="zen-welcome-import-profile-check" aria-hidden="true" />
                      <span className="zen-welcome-import-profile-name">
                        {profile?.name || profile?.id || source.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset
        data-active={focus == "search" ? "" : undefined}
        onFocus={() => setFocus("search")}
        onPointerDown={() => setFocus("search")}
      >
        <T as="legend" id="zendia-welcome-search-heading" />
        <div className="zen-welcome-fieldset-grid">
          {(engines?.engines ?? []).map(engine => (
            <Option
              key={engine.name}
              id={`zen-welcome-engine-${engine.name.replace(/\s+/g, "-")}`}
              group="zen-welcome-search-engine"
              text={engine.name}
              icon={engine.iconURL}
              checked={answers.engine == engine.name}
              onChoose={() => {
                answer("engine", engine.name);
                host.setSearchEngine(engine.name);
              }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset
        data-active={focus == "default" ? "" : undefined}
        onFocus={() => setFocus("default")}
        onPointerDown={() => setFocus("default")}
      >
        <T as="legend" id="zendia-welcome-default-heading" />
        <div className="zen-welcome-pair">
          <Option
            id="zen-welcome-set-default-browser"
            group="zen-welcome-default-browser"
            l10n="zendia-welcome-default-yes"
            checked={answers.defaultBrowser}
            onChoose={() => answer("defaultBrowser", true)}
          />
          <Option
            id="zen-welcome-dont-set-default-browser"
            group="zen-welcome-default-browser"
            l10n="zendia-welcome-default-no"
            checked={!answers.defaultBrowser}
            onChoose={() => answer("defaultBrowser", false)}
          />
        </div>
      </fieldset>
    </>
  );
}

function AppChoices({ apps, answer, setAnswer }) {
  return (
    <div id="zen-welcome-essentials">
      {apps.map(app => {
        const selected = answer.includes(app.url);
        return (
          <button
            key={app.url}
            type="button"
            className="zen-welcome-essential"
            data-url={app.url}
            aria-pressed={selected}
            aria-label={app.name}
            title={app.name}
            selected={selected ? "" : undefined}
            style={{ "--zen-welcome-app-color": app.color }}
            onClick={() => setAnswer(selected ? answer.filter(url => url != app.url) : [...answer, app.url])}
          >
            <span className="zen-welcome-essential-icon" aria-hidden="true">
              <img src={app.icon} alt="" />
            </span>
            <span className="zen-welcome-essential-name">{app.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function App({ host, dev = {} }) {
  // -1 is the Living Emblem start page.
  const [step, setStep] = useState(dev.step ?? -1);
  const [reached, setReached] = useState(dev.step ?? 0);
  const [direction, setDirection] = useState(1);
  const [beat, setBeat] = useState(-1);
  const [moveFocus, setMoveFocus] = useState("import");
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [finished, setFinished] = useState(false);
  const [answers, setAnswers] = useState(() => ({
    import: { source: -1, profiles: {} },
    vim: dev.choice ?? host.vimEnabled,
    agent: null,
    engine: null,
    ads: dev.choice ?? host.adBlocking,
    essentials: dev.essentials ?? [],
    defaultBrowser: dev.choice ?? false,
  }));

  // Unlock Web Audio cleanly on the user's first gesture.
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted(prev => {
      const nextMuted = !prev;
      sound.setMuted(nextMuted);
      if (!nextMuted) {
        sound.playMode(CHAPTERS[step]?.pose ?? "n");
      }
      return nextMuted;
    });
  }, [step]);

  const answer = useCallback((name, value) => {
    setAnswers(all => {
      if (name === "essentials") {
        const added = value.length > all.essentials.length;
        sound.playAppPin(added, added ? value.length : all.essentials.length);
      } else if (typeof value === "boolean") {
        sound.playSelect(value);
      } else {
        sound.playSelect(true);
      }
      return { ...all, [name]: value };
    });
    setNudge(count => count + 1);
  }, []);

  const sources = useHostData(() => host.getImportSources());
  const agents = useHostData(() => host.getAgents());
  const engines = useHostData(() => host.getSearchEngines());

  useEffect(() => {
    if (agents?.preferredId) {
      setAnswers(all => (all.agent === null ? { ...all, agent: agents.preferredId } : all));
    }
  }, [agents]);

  useEffect(() => {
    if (engines?.defaultName) {
      setAnswers(all => (all.engine === null ? { ...all, engine: engines.defaultName } : all));
    }
  }, [engines]);

  const theme = useMemo(() => makeTheme(host.dark), [host.dark]);
  const still = useMemo(
    () => host.reducedMotion || matchMedia("(prefers-reduced-motion: reduce)").matches,
    [host]
  );

  const chapter = CHAPTERS[step];
  const started = step >= 0;
  const last = step == CHAPTERS.length - 1;
  const activeMode = chapter?.pose ?? "n";
  const activeModeMeta = MODE_META[activeMode] ?? MODE_META.n;
  const activeModeColor = theme.dark ? activeModeMeta.color : activeModeMeta.colorLight;

  const go = (to, way, { silent = false } = {}) => {
    setDirection(way);
    setStep(to);
    setReached(most => Math.max(most, to));
    setPaused(false);
    if (!silent) {
      sound.playStep(CHAPTERS[to]?.pose ?? "n", way);
    }
  };

  // What a chapter decided takes effect when it is left forwards.
  const commit = () => {
    switch (chapter.id) {
      case "keys":
        host.setVimMode(answers.vim);
        break;
      case "agent":
        if (answers.agent) {
          host.chooseAgent(answers.agent);
        }
        break;
      case "shield":
        host.setAdBlocking(answers.ads);
        break;
      case "move-in":
        if (answers.import.source >= 0) {
          host.startImport(answers.import.source, answers.import.profiles[answers.import.source] ?? 0);
        }
        host.setDefaultBrowser(answers.defaultBrowser);
        break;
      case "apps":
        host.setEssentials(answers.essentials);
        break;
    }
  };

  const next = () => {
    if (finished) {
      return;
    }
    if (!started) {
      sound.playStart();
      go(0, 1, { silent: true });
      return;
    }
    commit();
    if (last) {
      sound.playFinish();
      setFinished(true);
      host.finish();
      return;
    }
    go(step + 1, 1);
  };

  const back = () => {
    if (step > 0 && !finished) {
      go(step - 1, -1);
    }
  };

  const skip = () => {
    host.setEssentials([]);
    answer("essentials", []);
    go(step + 1, 1);
  };

  // Enter moves on and Backspace goes back, wherever the focus is, except
  // on a button, which Enter presses.
  const keys = useRef();
  keys.current = { next, back };
  useEffect(() => {
    const onKeyDown = event => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      if (event.key == "Enter" && event.target.localName != "button") {
        event.preventDefault();
        keys.current.next();
      } else if (event.key == "Backspace") {
        event.preventDefault();
        keys.current.back();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const primary = useRef();
  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, [step]);

  // Vim mode shows in subsequent previews once it has been chosen.
  const vim = step > 0 && answers.vim;
  const selectedAgent = agents?.installed?.find(candidate => candidate.id == answers.agent);
  const agentInfo = selectedAgent
    ? { name: selectedAgent.name, color: selectedAgent.color ?? AGENT_COLORS[selectedAgent.id] ?? theme.modes.e }
    : null;
  const selectedApps = answers.essentials
    .map(url => host.essentialApps.find(app => app.url == url))
    .filter(Boolean);

  let stageContent = null;
  let stageCaption = null;
  switch (chapter?.id) {
    case "keys":
      stageContent = (
        <VimScene2D
          theme={theme}
          enabled={answers.vim}
          still={still}
          paused={paused}
          frozenAt={dev.frozenAt}
          onBeat={setBeat}
        />
      );
      stageCaption = (
        <div className="zen-welcome-zendia-keys">
          {VIM_KEYS.map(([keyNames, l10n], index) => (
            <div key={l10n} className="zen-welcome-zendia-key" data-active={answers.vim && index == beat ? "" : undefined}>
              <kbd>{keyNames}</kbd>
              <T id={l10n} />
            </div>
          ))}
        </div>
      );
      break;
    case "agent":
      stageContent = (
        <AgentScene2D
          theme={theme}
          agent={agentInfo}
          vim={vim}
          still={still}
          paused={paused}
          frozenAt={dev.frozenAt}
        />
      );
      break;
    case "shield":
      stageContent = (
        <ShieldScene2D
          theme={theme}
          enabled={answers.ads}
          vim={vim}
          still={still}
          paused={paused}
          frozenAt={dev.frozenAt}
        />
      );
      break;
    case "move-in":
      stageContent = (
        <MoveInScene2D
          theme={theme}
          focus={moveFocus}
          source={sources?.[answers.import.source] ?? null}
          engine={engines?.engines.find(engine => engine.name == answers.engine) ?? null}
          defaultBrowser={answers.defaultBrowser}
          vim={vim}
          still={still}
          paused={paused}
          frozenAt={dev.frozenAt}
        />
      );
      break;
    case "apps":
      stageContent = <AppsScene2D theme={theme} apps={selectedApps} vim={vim} still={still} />;
      break;
    case "go":
      stageContent = (
        <GoScene2D
          theme={theme}
          vim={vim}
          ads={answers.ads}
          agent={agentInfo}
          essentials={selectedApps}
          still={still}
        />
      );
      break;
  }

  let choices = null;
  switch (chapter?.id) {
    case "keys":
      choices = (
        <YesNo
          name="zen-welcome-zendia-keys"
          l10n="zendia-welcome-keys"
          value={answers.vim}
          onChange={value => answer("vim", value)}
        />
      );
      break;
    case "agent":
      choices = (
        <AgentChoices agents={agents} answer={answers.agent} setAnswer={value => answer("agent", value)} />
      );
      break;
    case "shield":
      choices = (
        <YesNo
          name="zen-welcome-block-ads"
          l10n="zendia-welcome-shield"
          value={answers.ads}
          onChange={value => answer("ads", value)}
        />
      );
      break;
    case "move-in":
      choices = (
        <MoveInChoices
          sources={sources}
          engines={engines}
          answers={answers}
          answer={answer}
          host={host}
          focus={moveFocus}
          setFocus={setMoveFocus}
        />
      );
      break;
    case "apps":
      choices = (
        <AppChoices
          apps={host.essentialApps}
          answer={answers.essentials}
          setAnswer={value => answer("essentials", value)}
        />
      );
      break;
    case "go":
      choices = answers.vim ? (
        <T as="p" id="zendia-welcome-go-vim-hint" className="zen-welcome-status zen-welcome-go-hint" />
      ) : null;
      break;
  }

  return (
    <main
      id="zen-welcome-app"
      data-started={started ? "" : undefined}
      data-step={chapter?.id ?? "start"}
      data-mode={activeMode}
      data-direction={direction}
      data-finished={finished ? "" : undefined}
      style={{ "--mode-accent": activeModeColor, "--mode-pastel": activeModeMeta.color }}
    >
      {/* Subtle ambient Voronoi glow tinted by the active chapter's mode cell */}
      <div className="z2d-ambient-field" aria-hidden="true" />

      {!started && (
        <div className="z2d-start-layout">
          <SoundToggle muted={muted} onToggle={toggleMuted} className="is-floating" />
          <section id="zen-welcome-start">
            <div className="z2d-brand-lockup">
              <Mascot pose="n" still blink={false} className="z2d-brand-mini-mascot" />
              <T id="zendia-welcome-brand" className="zen-welcome-brand" />
            </div>
            <T as="h1" id="zendia-welcome-start-title" />
            <T as="p" id="zendia-welcome-start-description" />
            <div className="z2d-start-actions">
              <button
                type="button"
                id="zen-welcome-start-button"
                className="zen-welcome-button primary"
                ref={primary}
                onClick={next}
              >
                <T id="zendia-welcome-start" />
                <Key id="zendia-welcome-key-enter" />
              </button>
            </div>
          </section>

          <div id="zen-welcome-stage" className="is-start">
            <StartScene2D theme={theme} still={still} />
          </div>
        </div>
      )}

      {started && (
        <div className="z2d-flow-layout">
          <nav id="zen-welcome-rail" aria-label="Onboarding steps">
            <div className="z2d-rail-brand">
              <Mascot pose={chapter.pose} still={still} blink={false} className="z2d-rail-mini-mascot" />
              <T id="zendia-welcome-brand" className="zen-welcome-brand" />
            </div>
            <div className="z2d-rail-right">
              <ol>
                {CHAPTERS.map((item, index) => {
                  const meta = MODE_META[item.pose];
                  const cellColor = theme.dark ? meta.color : meta.colorLight;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="zen-welcome-chapter"
                        style={{ "--chapter-color": cellColor, "--chapter-pastel": meta.color }}
                        aria-current={index == step ? "step" : undefined}
                        data-done={index < step ? "" : undefined}
                        disabled={index > reached || finished}
                        onClick={() => index != step && go(index, index > step ? 1 : -1)}
                      >
                        <span className="zen-welcome-chapter-cell" aria-hidden="true" />
                        <span className="zen-welcome-chapter-num" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <T id={`zendia-welcome-chapter-${item.id}`} className="zen-welcome-chapter-label" />
                      </button>
                    </li>
                  );
                })}
              </ol>
              <SoundToggle muted={muted} onToggle={toggleMuted} />
            </div>
          </nav>

          <div className="z2d-workspace">
            <section id="zen-welcome-deck">
              <div className="zen-welcome-guide">
                <div className="z2d-companion-slot">
                  <Mascot pose={chapter.pose} still={still} blink={!still} nudge={nudge} />
                </div>
                <div className="zen-welcome-text" key={chapter.id}>
                  <span className="z2d-mode-tag" aria-hidden="true">
                    <span className="z2d-mode-tag-dot" />
                    {activeModeMeta.name}
                  </span>
                  <T as="h1" id={`zendia-welcome-${chapter.id}-title`} />
                  <T as="p" id={`zendia-welcome-${chapter.id}-description`} />
                </div>
              </div>

              <div id="zen-welcome-page-content">
                <div className="zen-welcome-page" page={chapter.id} key={chapter.id}>
                  {choices}
                </div>
              </div>

              <div id="zen-welcome-nav">
                <button
                  type="button"
                  id="zen-welcome-back"
                  className="zen-welcome-button"
                  disabled={step == 0 || finished}
                  onClick={back}
                >
                  <T id="zendia-welcome-back" />
                  <Key id="zendia-welcome-key-backspace" />
                </button>
                <div className="z2d-nav-right">
                  {chapter.skip && (
                    <button
                      type="button"
                      id="zen-welcome-skip"
                      className="zen-welcome-button ghost"
                      disabled={finished}
                      onClick={skip}
                    >
                      <T id="zendia-welcome-skip" />
                    </button>
                  )}
                  <button
                    type="button"
                    id="zen-welcome-next"
                    className="zen-welcome-button primary"
                    ref={primary}
                    disabled={finished}
                    onClick={next}
                  >
                    <T id={last ? "zendia-welcome-finish" : "zendia-welcome-next"} />
                    <Key id="zendia-welcome-key-enter" />
                  </button>
                </div>
              </div>
            </section>

            <div id="zen-welcome-stage" className="is-chapter">
              <Stage2D
                accent={activeModeColor}
                still={still}
                looping={chapter.looping}
                paused={paused}
                onTogglePause={() => setPaused(p => !p)}
                caption={stageCaption}
              >
                <div className="z2d-scene-swap" key={chapter.id}>
                  {stageContent}
                </div>
              </Stage2D>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
