// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The onboarding. A start page, then six chapters: what makes Zendia itself
// first (its keys, its agent, its ad blocking), the chores of moving in on
// one page after that, then the apps to pin, and off you go.
//
// The preview fills the window. Over its lower edge lies the deck, a slanted
// panel where the mascot says what the chapter is about and the choices are
// made; along the top runs the row of chapters. Enter moves on and Backspace
// goes back, as the buttons say.
//
// Everything that touches the browser goes through `host`, the object
// ZenWelcome.mjs hands over (dev/host.js stands in for it on the dev page).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Stage } from "./stage/Stage.jsx";
import { AGENT_COLORS, makeTheme } from "./stage/kit.js";
import { AgentsScene } from "./stage/scenes/AgentsScene.jsx";
import { DefaultScene } from "./stage/scenes/DefaultScene.jsx";
import { EssentialsScene } from "./stage/scenes/EssentialsScene.jsx";
import { HeroScene } from "./stage/scenes/HeroScene.jsx";
import { ImportScene } from "./stage/scenes/ImportScene.jsx";
import { SearchScene } from "./stage/scenes/SearchScene.jsx";
import { ShieldScene } from "./stage/scenes/ShieldScene.jsx";
import { VimScene } from "./stage/scenes/VimScene.jsx";
import { Key, Mascot, Option, T, YesNo } from "./ui.jsx";

// `pose` is the mascot's drawing while it tells the chapter.
const CHAPTERS = [
  { id: "keys", pose: "n" },
  { id: "agent", pose: "e" },
  { id: "shield", pose: "t" },
  { id: "move-in", pose: "l" },
  { id: "apps", pose: "i", skip: true },
  { id: "go", pose: "v" },
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
            <div key={agent.name}>
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

// Moving in: three small decisions side by side. The preview shows the one
// last touched.
function MoveInChoices({ sources, engines, answers, answer, host, setFocus }) {
  const imported = answers.import;
  return (
    <>
      <fieldset onFocus={() => setFocus("import")} onPointerDown={() => setFocus("import")}>
        <T as="legend" id="zendia-welcome-import-heading" />
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
                      onChange={() => answer("import", { ...imported, profiles: { ...imported.profiles, [index]: profileIndex } })}
                    />
                    <span className="zen-welcome-import-profile-check" aria-hidden="true" />
                    <span className="zen-welcome-import-profile-name">{profile?.name || profile?.id || source.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </fieldset>

      <fieldset onFocus={() => setFocus("search")} onPointerDown={() => setFocus("search")}>
        <T as="legend" id="zendia-welcome-search-heading" />
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
      </fieldset>

      <fieldset onFocus={() => setFocus("default")} onPointerDown={() => setFocus("default")}>
        <T as="legend" id="zendia-welcome-default-heading" />
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
            <img src={app.icon} alt="" />
          </button>
        );
      })}
    </div>
  );
}

export function App({ host, dev = {} }) {
  // -1 is the start page.
  const [step, setStep] = useState(dev.step ?? -1);
  const [reached, setReached] = useState(dev.step ?? 0);
  const [direction, setDirection] = useState(1);
  const [beat, setBeat] = useState(-1);
  const [moveFocus, setMoveFocus] = useState("import");
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
  const answer = useCallback((name, value) => setAnswers(all => ({ ...all, [name]: value })), []);

  const sources = useHostData(() => host.getImportSources());
  const agents = useHostData(() => host.getAgents());
  const engines = useHostData(() => host.getSearchEngines());
  useEffect(() => {
    if (agents?.preferredId) {
      answer("agent", agents.preferredId);
    }
  }, [agents, answer]);
  useEffect(() => {
    if (engines?.defaultName) {
      answer("engine", engines.defaultName);
    }
  }, [engines, answer]);

  const theme = useMemo(() => makeTheme(host.dark), [host.dark]);
  const still = useMemo(() => host.reducedMotion || matchMedia("(prefers-reduced-motion: reduce)").matches, [host]);
  const chapter = CHAPTERS[step];
  const started = step >= 0;
  const last = step == CHAPTERS.length - 1;

  const go = (to, way) => {
    setDirection(way);
    setStep(to);
    setReached(most => Math.max(most, to));
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
      go(0, 1);
      return;
    }
    commit();
    if (last) {
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

  // The preview ends where the deck begins, however tall the deck is.
  const root = useRef();
  const deck = useRef();
  useLayoutEffect(() => {
    if (!deck.current) {
      root.current.style.setProperty("--deck", "0px");
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      root.current?.style.setProperty("--deck", `${deck.current.offsetHeight}px`);
    });
    observer.observe(deck.current);
    return () => observer.disconnect();
  }, [started]);

  const primary = useRef();
  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, [step]);

  // Vim mode shows in the previews once it has been chosen.
  const vim = step > 0 && answers.vim;
  const agent = agents?.installed?.find(candidate => candidate.id == answers.agent);
  let scene = null;
  switch (chapter?.id) {
    case undefined:
    case "go":
      scene = <HeroScene vim={vim} wide={!started} />;
      break;
    case "keys":
      scene = <VimScene enabled={answers.vim} onBeat={setBeat} />;
      break;
    case "agent":
      scene = <AgentsScene agent={agent ? { name: agent.name, color: agent.color ?? AGENT_COLORS[agent.id] } : null} vim={vim} />;
      break;
    case "shield":
      scene = <ShieldScene enabled={answers.ads} vim={vim} />;
      break;
    case "move-in":
      if (moveFocus == "search") {
        scene = <SearchScene engine={engines?.engines.find(engine => engine.name == answers.engine) ?? null} vim={vim} />;
      } else if (moveFocus == "default") {
        scene = <DefaultScene enabled={answers.defaultBrowser} vim={vim} />;
      } else {
        scene = <ImportScene source={sources?.[answers.import.source] ?? null} vim={vim} />;
      }
      break;
    case "apps":
      scene = <EssentialsScene apps={answers.essentials.map(url => host.essentialApps.find(app => app.url == url))} vim={vim} />;
      break;
  }

  let choices = null;
  switch (chapter?.id) {
    case "keys":
      choices = <YesNo name="zen-welcome-zendia-keys" l10n="zendia-welcome-keys" value={answers.vim} onChange={value => answer("vim", value)} />;
      break;
    case "agent":
      choices = <AgentChoices agents={agents} answer={answers.agent} setAnswer={value => answer("agent", value)} />;
      break;
    case "shield":
      choices = <YesNo name="zen-welcome-block-ads" l10n="zendia-welcome-shield" value={answers.ads} onChange={value => answer("ads", value)} />;
      break;
    case "move-in":
      choices = <MoveInChoices sources={sources} engines={engines} answers={answers} answer={answer} host={host} setFocus={setMoveFocus} />;
      break;
    case "apps":
      choices = <AppChoices apps={host.essentialApps} answer={answers.essentials} setAnswer={value => answer("essentials", value)} />;
      break;
    case "go":
      choices = answers.vim ? <T as="p" id="zendia-welcome-go-vim-hint" className="zen-welcome-status" /> : null;
      break;
  }

  return (
    <main
      id="zen-welcome-app"
      ref={root}
      data-started={started ? "" : undefined}
      data-step={chapter?.id ?? "start"}
      data-direction={direction}
      data-finished={finished ? "" : undefined}
    >
      <div id="zen-welcome-stage">
        {scene && (
          <Stage theme={theme} still={still} frozenAt={dev.frozenAt} frozenStrike={dev.frozenStrike}>
            {scene}
          </Stage>
        )}
        {chapter?.id == "keys" && (
          <div className="zen-welcome-zendia-keys">
            {VIM_KEYS.map(([keyNames, l10n], index) => (
              <div key={l10n} className="zen-welcome-zendia-key" data-active={answers.vim && index == beat ? "" : undefined}>
                <kbd>{keyNames}</kbd>
                <T id={l10n} />
              </div>
            ))}
          </div>
        )}
      </div>

      {!started && (
        <section id="zen-welcome-start">
          <T as="h1" id="zendia-welcome-start-title" />
          <T as="p" id="zendia-welcome-start-description" />
          <button type="button" id="zen-welcome-start-button" className="zen-welcome-button primary" ref={primary} onClick={next}>
            <T id="zendia-welcome-start" />
            <Key id="zendia-welcome-key-enter" />
          </button>
        </section>
      )}

      {started && (
        <>
          <nav id="zen-welcome-rail">
            <T id="zendia-welcome-brand" className="zen-welcome-brand" />
            <ol>
              {CHAPTERS.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="zen-welcome-chapter"
                    aria-current={index == step ? "step" : undefined}
                    data-done={index < step ? "" : undefined}
                    disabled={index > reached || finished}
                    onClick={() => index != step && go(index, index > step ? 1 : -1)}
                  >
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <T id={`zendia-welcome-chapter-${item.id}`} />
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <section id="zen-welcome-deck" ref={deck}>
            <div className="zen-welcome-guide">
              <Mascot pose={chapter.pose} still={still} />
              <div className="zen-welcome-text" key={chapter.id}>
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
              <button type="button" id="zen-welcome-back" className="zen-welcome-button" disabled={step == 0 || finished} onClick={back}>
                <T id="zendia-welcome-back" />
                <Key id="zendia-welcome-key-backspace" />
              </button>
              {chapter.skip && (
                <button type="button" id="zen-welcome-skip" className="zen-welcome-button" disabled={finished} onClick={skip}>
                  <T id="zendia-welcome-skip" />
                </button>
              )}
              <button type="button" id="zen-welcome-next" className="zen-welcome-button primary" ref={primary} disabled={finished} onClick={next}>
                <T id={last ? "zendia-welcome-finish" : "zendia-welcome-next"} />
                <Key id="zendia-welcome-key-enter" />
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
