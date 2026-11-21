// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What can be asked of a chat site about something on a page: the built-in
// prompts, then the user's own from zendia.webchat.prompts, in the same
// shape as zendia.webchat.custom:
//
//   [
//     { "id": "eli5", "label": "Explain Like I'm Five", "key": "5",
//       "on": ["selection", "page"],
//       "prompt": "Explain this simply:\n\n{{quote}}\n\nFrom: {{source}}" },
//     { "id": "factcheck", "site": "perplexity" },
//     { "id": "define", "hidden": true }
//   ]
//
// An entry with the id of a built-in prompt changes its fields, `hidden`
// takes it away. `site` sends it to that chat site whichever is in front,
// `send: false` leaves it in the site's box for the user to finish, and
// prompts with the same `group` share a submenu.
//
// A prompt is a template. {{text}} is what it is about as it is, {{quote}}
// the same set apart for the chat, {{title}}, {{url}} and {{source}} the
// page it is on, {{page}} the page's text, {{lang}} the language to
// translate into or answer in, and {{tabs}} the pages of several tabs. A
// line whose
// placeholders all came out empty is left out.

/**
 * What a prompt can be about.
 *
 * selection: text selected on a page. editable: text selected in a field,
 * whose reply can be put back in its place. image, video: an image, or the
 * frame a video shows. link: the page a link goes to. page: the page in
 * front. tabs: the pages of the tabs picked. region: a part of the page cut
 * out of the screen.
 */
export const KINDS = [
  "selection",
  "editable",
  "image",
  "video",
  "link",
  "page",
  "tabs",
  "region",
];

// What a kind has to show the chat: an image, or text.
const IMAGE_KINDS = new Set(["image", "video", "region"]);

const SOURCE = "From: {{source}}";

/**
 * @typedef {object} ZendiaWebChatPrompt
 * @property {string} id What the user's entries call it.
 * @property {string} label What the menu and the picker call it.
 * @property {string} [key] The key that picks it in the picker and the menu.
 * @property {string[]} on The kinds it is offered for.
 * @property {string} prompt The template.
 * @property {boolean} send Whether it is sent at once.
 * @property {string} [site] The chat site it always goes to.
 * @property {string} [group] The submenu it is in.
 * @property {number} [maxWords] Offered only for this few words or fewer.
 * @property {boolean} [translates] It translates: the keys ask which language
 *   into.
 * @property {boolean} [custom] Added by the user.
 */

// The prompts whose answer is written in the language picked last. The
// others keep the language of what they are about: a rewrite, a fix, a
// reply to a message, the text read out of an image.
const ANSWERING = new Set([
  "explain",
  "summarize",
  "define",
  "factcheck",
  "describe",
  "explain-image",
  "summarize-link",
  "summarize-page",
  "key-points",
  "summarize-tabs",
  "compare-tabs",
]);

/** @type {ZendiaWebChatPrompt[]} */
const PROMPTS = [
  {
    id: "explain",
    label: "Explain",
    key: "e",
    on: ["selection", "editable"],
    prompt: `Explain this in plain words:\n\n{{quote}}\n\n${SOURCE}`,
  },
  {
    id: "summarize",
    label: "Summarize",
    key: "s",
    on: ["selection"],
    prompt: `Summarize this in a few short bullet points:\n\n{{quote}}\n\n${SOURCE}`,
  },
  {
    id: "translate",
    translates: true,
    label: "Translate to {{lang}}",
    key: "t",
    on: ["selection", "editable"],
    prompt:
      "Translate this into {{lang}}. Reply with the translation only.\n\n{{quote}}",
  },
  {
    id: "define",
    label: "Define",
    key: "d",
    on: ["selection"],
    maxWords: 4,
    prompt:
      'What does "{{text}}" mean here? Answer in two or three sentences.\n\nContext: {{context}}\n\n' +
      SOURCE,
  },
  {
    id: "factcheck",
    label: "Fact-Check",
    key: "f",
    on: ["selection"],
    prompt:
      "Fact-check this. Say what holds up, what does not, and how sure you are, " +
      `with sources.\n\n{{quote}}\n\n${SOURCE}`,
  },
  {
    id: "reply",
    label: "Draft a Reply",
    key: "y",
    on: ["selection"],
    prompt:
      "Draft a reply to this message. Keep it short and plain, and reply with " +
      "the draft only.\n\n{{quote}}",
  },
  {
    id: "rewrite",
    label: "Rewrite",
    key: "r",
    on: ["editable"],
    prompt:
      "Rewrite this so it reads better. Keep its meaning and its language. " +
      "Reply with the new text only.\n\n{{quote}}",
  },
  {
    id: "grammar",
    label: "Fix Spelling and Grammar",
    key: "g",
    on: ["editable"],
    prompt:
      "Fix the spelling and grammar of this, and change nothing else. Reply " +
      "with the corrected text only.\n\n{{quote}}",
  },
  {
    id: "shorter",
    label: "Make Shorter",
    key: "h",
    on: ["editable"],
    prompt:
      "Make this shorter without losing anything that matters. Keep its " +
      "language. Reply with the new text only.\n\n{{quote}}",
  },
  {
    id: "longer",
    label: "Make Longer",
    key: "l",
    on: ["editable"],
    prompt:
      "Expand this with a little more detail. Keep its language and its " +
      "voice. Reply with the new text only.\n\n{{quote}}",
  },
  ...[
    ["formal", "Formal", "1"],
    ["friendly", "Friendly", "2"],
    ["confident", "Confident", "3"],
    ["casual", "Casual", "4"],
  ].map(([tone, label, key]) => ({
    id: `tone-${tone}`,
    label,
    key,
    group: "Change Tone",
    on: ["editable"],
    prompt:
      `Rewrite this in a ${tone} tone. Keep its meaning and its language. ` +
      "Reply with the new text only.\n\n{{quote}}",
  })),
  {
    id: "describe",
    label: "Describe",
    key: "d",
    on: ["image", "video", "region"],
    prompt: `Describe what this shows.\n\n${SOURCE}`,
  },
  {
    id: "ocr",
    label: "Extract Text",
    key: "x",
    on: ["image", "video", "region"],
    prompt:
      "Write out all the text in this image, laid out as it is. Reply with " +
      "the text only.",
  },
  {
    id: "translate-image",
    translates: true,
    label: "Translate Text in Image to {{lang}}",
    key: "t",
    on: ["image", "video", "region"],
    prompt: "Translate the text in this image into {{lang}}.",
  },
  {
    id: "explain-image",
    label: "Explain",
    key: "e",
    on: ["image", "video", "region"],
    prompt: `Explain this: what it is, and what it means.\n\n${SOURCE}`,
  },
  {
    id: "summarize-link",
    label: "Summarize Linked Page",
    key: "s",
    on: ["link"],
    prompt:
      "Summarize this page in a few short bullet points.\n\n" +
      "# {{title}}\n{{url}}\n\n{{page}}",
  },
  {
    id: "summarize-page",
    label: "Summarize Page",
    key: "s",
    on: ["page"],
    prompt:
      "Summarize this page in a few short bullet points.\n\n" +
      "# {{title}}\n{{url}}\n\n{{page}}",
  },
  {
    id: "key-points",
    label: "Key Points and Action Items",
    key: "k",
    on: ["page"],
    prompt:
      "List the key points of this page, then any action items or " +
      "deadlines it mentions.\n\n# {{title}}\n{{url}}\n\n{{page}}",
  },
  {
    id: "translate-page",
    translates: true,
    label: "Translate Page to {{lang}}",
    key: "t",
    on: ["page"],
    prompt:
      "Translate this page into {{lang}}, keeping its headings.\n\n" +
      "# {{title}}\n\n{{page}}",
  },
  {
    id: "summarize-tabs",
    label: "Summarize Each",
    key: "s",
    on: ["tabs"],
    prompt:
      "Summarize each of these pages in two or three bullet points, under " +
      "its title.\n\n{{tabs}}",
  },
  {
    id: "compare-tabs",
    label: "Compare",
    key: "c",
    on: ["tabs"],
    prompt:
      "Compare these pages: what they have in common, how they differ, and " +
      "which comes out best for what. End with a short table.\n\n{{tabs}}",
  },
];

/** @type {ZendiaWebChatPrompt[]} */
export const BUILTIN_PROMPTS = PROMPTS.map(prompt =>
  ANSWERING.has(prompt.id)
    ? {
        ...prompt,
        label: `${prompt.label} in {{lang}}`,
        prompt: inLanguage(prompt.prompt),
      }
    : prompt
);

/**
 * A template whose answer is written in {{lang}}: said in its instruction,
 * where the chat reads it first, and again at its end, after a page's text
 * that could bury the first.
 *
 * @param {string} template
 * @returns {string}
 */
export function inLanguage(template) {
  const end = template.indexOf("\n\n");
  const instruction = end == -1 ? template : template.slice(0, end);
  const rest = end == -1 ? "" : template.slice(end);
  const said = instruction.endsWith(":")
    ? `${instruction.slice(0, -1)}, in {{lang}}:`
    : `${instruction} Write the answer in {{lang}}.`;
  return `${said}${rest}\n\nAnswer in {{lang}}.`;
}

// What "Ask…" leaves in the box for the user to finish, by kind.
const ASK_TEMPLATES = {
  selection: `{{quote}}\n\n${SOURCE}\n\n`,
  editable: "{{quote}}\n\n",
  image: `${SOURCE}\n\n`,
  video: `${SOURCE}\n\n`,
  region: `${SOURCE}\n\n`,
  link: "# {{title}}\n{{url}}\n\n{{page}}\n\n",
  page: "# {{title}}\n{{url}}\n\n{{page}}\n\n",
  tabs: "{{tabs}}\n\n",
};

/**
 * The prompt that leaves what it is about in the chat site's box, unsent,
 * for the user to ask their own question.
 *
 * @param {string} kind
 * @returns {ZendiaWebChatPrompt}
 */
export function askPrompt(kind) {
  return {
    id: "ask",
    label: "Ask…",
    key: "a",
    on: [kind],
    prompt: ASK_TEMPLATES[kind] ?? "{{quote}}\n\n",
    send: false,
  };
}

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_LABEL = 60;
const MAX_PROMPT = 4000;
const MAX_PROMPTS = 48;

/**
 * Read the user's entries from their pref's JSON. Entries that are not
 * valid are left out, one bad entry never takes the others down.
 *
 * @param {string} json
 * @returns {object[]}
 */
export function parsePrompts(json) {
  let list;
  try {
    list = JSON.parse(json || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  const entries = [];
  for (const entry of list.slice(0, MAX_PROMPTS)) {
    if (
      !entry ||
      typeof entry != "object" ||
      !ID.test(entry.id ?? "") ||
      entry.id == "ask" ||
      seen.has(entry.id)
    ) {
      continue;
    }
    seen.add(entry.id);
    const clean = { id: entry.id };
    if (entry.hidden === true) {
      clean.hidden = true;
    }
    for (const [field, max] of [
      ["label", MAX_LABEL],
      ["prompt", MAX_PROMPT],
      ["group", MAX_LABEL],
    ]) {
      if (typeof entry[field] == "string" && entry[field].trim()) {
        clean[field] = entry[field].trim().slice(0, max);
      }
    }
    if (typeof entry.key == "string" && /^\S$/u.test(entry.key)) {
      clean.key = entry.key;
    }
    if (typeof entry.site == "string" && ID.test(entry.site)) {
      clean.site = entry.site;
    }
    for (const field of ["send", "translates"]) {
      if (typeof entry[field] == "boolean") {
        clean[field] = entry[field];
      }
    }
    if (Array.isArray(entry.on)) {
      const on = entry.on.filter(kind => KINDS.includes(kind));
      if (on.length) {
        clean.on = [...new Set(on)];
      }
    }
    entries.push(clean);
  }
  return entries;
}

/**
 * The prompts: the built-in ones, changed by the user's entries, then the
 * ones the user added. One the user added needs a prompt.
 *
 * @param {string} json The user's entries.
 * @returns {ZendiaWebChatPrompt[]}
 */
export function webChatPrompts(json) {
  const entries = parsePrompts(json);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const prompts = [];
  for (const base of BUILTIN_PROMPTS) {
    const entry = byId.get(base.id);
    byId.delete(base.id);
    if (entry?.hidden) {
      continue;
    }
    const merged = { send: true, ...base, ...(entry ?? {}) };
    delete merged.hidden;
    prompts.push(merged);
  }
  for (const entry of byId.values()) {
    if (entry.hidden || !entry.prompt) {
      continue;
    }
    prompts.push({
      send: true,
      on: ["selection", "editable"],
      label: entry.id,
      ...entry,
      custom: true,
    });
  }
  return prompts;
}

/**
 * @param {string} text
 * @returns {number}
 */
export function wordCount(text) {
  return String(text).trim().split(/\s+/u).filter(Boolean).length;
}

/**
 * The prompts offered for something.
 *
 * @param {ZendiaWebChatPrompt[]} prompts
 * @param {string} kind
 * @param {object} [what]
 * @param {string} [what.text] The text it is about, for prompts offered for
 *   a few words only.
 * @returns {ZendiaWebChatPrompt[]}
 */
export function promptsFor(prompts, kind, { text } = {}) {
  return prompts.filter(
    prompt =>
      prompt.on.includes(kind) &&
      (!prompt.maxWords ||
        text === undefined ||
        wordCount(text) <= prompt.maxWords)
  );
}

/**
 * Whether a kind shows the chat an image.
 *
 * @param {string} kind
 * @returns {boolean}
 */
export function isImageKind(kind) {
  return IMAGE_KINDS.has(kind);
}

/**
 * Text cut to a length, saying so at its end.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function cut(text, max) {
  const value = String(text ?? "");
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max).trimEnd()}\n\n[… cut here: the rest is longer than ${max} characters]`;
}

/**
 * Text set apart, for the chat to tell it from the question.
 *
 * @param {string} text
 * @returns {string}
 */
export function quote(text) {
  const value = String(text ?? "").trim();
  return value ? `"""\n${value}\n"""` : "";
}

const PLACEHOLDER = /\{\{\s*([a-z]+)\s*\}\}/g;

/**
 * Fill a template.
 *
 * @param {string} template
 * @param {Record<string, string>} values
 * @returns {string}
 */
export function render(template, values) {
  const lines = [];
  for (const line of String(template).split("\n")) {
    let used = 0;
    let filled = 0;
    const out = line.replace(PLACEHOLDER, (match, name) => {
      used++;
      const value = values[name] ?? "";
      if (value) {
        filled++;
      }
      return value;
    });
    if (!used || filled) {
      lines.push(out);
    }
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

/**
 * The values of a template for what it is about.
 *
 * @param {object} what
 * @param {string} [what.text]
 * @param {string} [what.context] The paragraph the text is in.
 * @param {string} [what.title]
 * @param {string} [what.url]
 * @param {string} [what.page]
 * @param {string} [what.lang]
 * @param {Array<{title: string, url: string, text: string}>} [what.tabs]
 * @param {object} [limits]
 * @param {number} [limits.text]
 * @param {number} [limits.page]
 * @returns {Record<string, string>}
 */
export function templateValues(
  what,
  { text: maxText = 30000, page: maxPage = 60000 } = {}
) {
  const text = cut((what.text ?? "").trim(), maxText);
  const title = (what.title ?? "").trim();
  const url = what.url ?? "";
  const tabs = what.tabs ?? [];
  const perTab = tabs.length ? Math.floor(maxPage / tabs.length) : 0;
  return {
    text,
    quote: quote(text),
    context: cut((what.context ?? "").trim(), 1500),
    title,
    url,
    source: [title, url].filter(Boolean).join(" — "),
    page: cut((what.page ?? "").trim(), maxPage),
    lang: what.lang ?? "",
    tabs: tabs
      .map(
        (tab, index) =>
          `## ${index + 1}. ${tab.title || tab.url}\n${tab.url}\n\n${cut((tab.text ?? "").trim(), perTab) || "(not loaded)"}`
      )
      .join("\n\n"),
  };
}

/**
 * A prompt's label, with the language in it.
 *
 * @param {ZendiaWebChatPrompt} prompt
 * @param {string} lang
 * @returns {string}
 */
export function labelOf(prompt, lang) {
  return prompt.label.replace(PLACEHOLDER, (match, name) =>
    name == "lang" ? lang : ""
  );
}

/**
 * Whether a prompt translates, so the keys ask which language into.
 *
 * @param {ZendiaWebChatPrompt} prompt
 * @returns {boolean}
 */
export function usesLanguage(prompt) {
  return !!prompt.translates;
}

/**
 * Whether a prompt's label names the language, and so changes with it.
 *
 * @param {ZendiaWebChatPrompt} prompt
 * @returns {boolean}
 */
export function namesLanguage(prompt) {
  return /\{\{\s*lang\s*\}\}/.test(prompt.label);
}

/** The languages offered besides the user's own and the recent ones. */
export const COMMON_LANGUAGES = [
  "en",
  "id",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "nl",
  "ru",
  "ja",
  "ko",
  "zh-Hans",
  "ar",
  "hi",
  "tr",
  "vi",
  "th",
  "ms",
];

const MAX_RECENT = 5;

/**
 * The recent languages with one more used, newest first.
 *
 * @param {string[]} recent
 * @param {string} code
 * @returns {string[]}
 */
export function withRecentLanguage(recent, code) {
  return [code, ...recent.filter(each => each != code)].slice(0, MAX_RECENT);
}

/**
 * Read the recent languages from their pref.
 *
 * @param {string} value Codes, separated by commas.
 * @returns {string[]}
 */
export function parseRecentLanguages(value) {
  return String(value ?? "")
    .split(",")
    .map(code => code.trim())
    .filter(code => /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(code))
    .slice(0, MAX_RECENT);
}

/**
 * The languages to offer, the one used last first.
 *
 * @param {string[]} recent
 * @param {string} own The browser's language.
 * @returns {string[]}
 */
export function languageChoices(recent, own) {
  return [...new Set([...recent, own, ...COMMON_LANGUAGES])];
}

/**
 * A language's name in English, or the language's own name as well when it
 * is not English.
 *
 * @param {string} code
 * @returns {string}
 */
export function languageName(code) {
  try {
    const english = new Intl.DisplayNames(["en"], { type: "language" }).of(
      code
    );
    return english ?? code;
  } catch {
    return code;
  }
}

/**
 * @param {string} code
 * @returns {string|null} The language's own name, when it is not the same
 *   as the English one.
 */
export function nativeLanguageName(code) {
  try {
    const native = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return native && native != languageName(code) ? native : null;
  } catch {
    return null;
  }
}
