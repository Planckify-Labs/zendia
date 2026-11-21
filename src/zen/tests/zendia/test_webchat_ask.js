/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  BUILTIN_PROMPTS,
  KINDS,
  askPrompt,
  cut,
  isImageKind,
  labelOf,
  languageChoices,
  namesLanguage,
  languageName,
  parsePrompts,
  parseRecentLanguages,
  promptsFor,
  quote,
  render,
  templateValues,
  usesLanguage,
  webChatPrompts,
  withRecentLanguage,
  wordCount,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/webchat/ZendiaWebChatPrompts.sys.mjs"
);

add_task(function test_builtin_prompts_are_well_formed() {
  const seen = new Set();
  for (const prompt of BUILTIN_PROMPTS) {
    Assert.ok(!seen.has(prompt.id), `${prompt.id} is used once`);
    seen.add(prompt.id);
    Assert.ok(prompt.label, `${prompt.id} has a label`);
    Assert.ok(prompt.prompt, `${prompt.id} has a prompt`);
    Assert.ok(
      prompt.on.length && prompt.on.every(kind => KINDS.includes(kind)),
      `${prompt.id} is offered for known kinds`
    );
  }
  for (const kind of KINDS) {
    const keys = promptsFor(webChatPrompts(""), kind)
      .filter(prompt => !prompt.group)
      .map(prompt => prompt.key);
    Assert.equal(
      new Set(keys).size,
      keys.length,
      `the prompts for ${kind} have keys of their own`
    );
    Assert.ok(!keys.includes("a"), `"a" stays for Ask… in ${kind}`);
  }
});

add_task(function test_user_entries_change_add_and_hide() {
  const prompts = webChatPrompts(
    JSON.stringify([
      { id: "factcheck", site: "perplexity" },
      { id: "define", hidden: true },
      {
        id: "eli5",
        label: "Explain Like I'm Five",
        key: "5",
        on: ["selection", "page", "nonsense"],
        prompt: "Explain simply:\n\n{{quote}}",
      },
      { id: "no-prompt" },
      { id: "Bad Id", prompt: "x" },
      { id: "ask", prompt: "taken" },
    ])
  );
  const byId = new Map(prompts.map(prompt => [prompt.id, prompt]));
  Assert.equal(byId.get("factcheck").site, "perplexity", "a site is pinned");
  Assert.equal(
    byId.get("factcheck").label,
    "Fact-Check in {{lang}}",
    "the rest stays"
  );
  Assert.ok(!byId.has("define"), "a hidden one goes");
  Assert.ok(byId.get("eli5").custom, "a new one is added");
  Assert.deepEqual(
    byId.get("eli5").on,
    ["selection", "page"],
    "unknown kinds are left out"
  );
  Assert.ok(byId.get("eli5").send, "a new one is sent by default");
  Assert.ok(!byId.has("no-prompt"), "a new one needs a prompt");
  Assert.ok(!byId.has("Bad Id"), "ids are checked");
  Assert.ok(!byId.has("ask"), "Ask… cannot be replaced");
  Assert.deepEqual(parsePrompts("not json"), [], "bad JSON is no entries");
  Assert.deepEqual(parsePrompts('{"id": "x"}'), [], "an object is no list");
});

add_task(function test_prompts_for_a_kind() {
  const prompts = webChatPrompts("");
  const ids = kind => promptsFor(prompts, kind).map(prompt => prompt.id);
  Assert.ok(ids("selection").includes("explain"), "explain a selection");
  Assert.ok(ids("editable").includes("rewrite"), "rewrite a field's text");
  Assert.ok(!ids("selection").includes("rewrite"), "but not a page's");
  Assert.ok(ids("image").includes("ocr"), "read an image's text");
  Assert.ok(ids("region").includes("describe"), "describe a region");
  Assert.ok(ids("page").includes("summarize-page"), "summarize a page");
  Assert.ok(ids("tabs").includes("compare-tabs"), "compare tabs");
  const define = kind => text =>
    promptsFor(prompts, kind, { text }).some(prompt => prompt.id == "define");
  Assert.ok(define("selection")("serendipity"), "define a word");
  Assert.ok(
    !define("selection")("one two three four five six"),
    "but not a sentence"
  );
  Assert.equal(wordCount("  a  b\nc "), 3, "words are counted");
});

add_task(function test_render_drops_empty_lines() {
  const values = templateValues({
    text: "  Hello world  ",
    title: "A page",
    url: "https://example.com/",
  });
  Assert.equal(values.quote, '"""\nHello world\n"""', "the text is set apart");
  Assert.equal(values.source, "A page — https://example.com/");
  Assert.equal(
    render("Explain:\n\n{{quote}}\n\nFrom: {{source}}", values),
    'Explain:\n\n"""\nHello world\n"""\n\nFrom: A page — https://example.com/'
  );
  Assert.equal(
    render("Explain:\n\n{{quote}}\n\nFrom: {{source}}", {
      ...values,
      source: "",
    }),
    'Explain:\n\n"""\nHello world\n"""\n',
    "a line with nothing in its placeholders goes"
  );
  Assert.equal(
    render("Keep {{text}} and {{nothing}}", values),
    "Keep Hello world and ",
    "a line with some of them filled stays"
  );
  Assert.equal(quote("  "), "", "nothing is not quoted");
});

add_task(function test_long_text_is_cut() {
  const long = "x".repeat(50);
  Assert.equal(cut(long, 100), long, "short text stays");
  const cutText = cut(long, 10);
  Assert.ok(cutText.startsWith("x".repeat(10)), "the start stays");
  Assert.ok(cutText.includes("longer than 10"), "and it says so");
  const values = templateValues(
    {
      tabs: [
        { title: "One", url: "https://one.example/", text: "a".repeat(100) },
        { title: "", url: "https://two.example/", text: "" },
      ],
    },
    { page: 100 }
  );
  Assert.ok(values.tabs.includes("## 1. One"), "each tab has its title");
  Assert.ok(
    values.tabs.includes("## 2. https://two.example/"),
    "or its address"
  );
  Assert.ok(values.tabs.includes("(not loaded)"), "an unloaded tab says so");
  Assert.ok(values.tabs.includes("longer than 50"), "the tabs share the room");
});

add_task(function test_ask_prompt_is_left_unsent() {
  for (const kind of KINDS) {
    const prompt = askPrompt(kind);
    Assert.equal(prompt.send, false, `Ask… is left in the box for ${kind}`);
    Assert.deepEqual(prompt.on, [kind]);
  }
  Assert.equal(
    render(askPrompt("selection").prompt, templateValues({ text: "Hi" })),
    '"""\nHi\n"""\n\n',
    "Ask… leaves the text and room for the question"
  );
  Assert.ok(isImageKind("region") && !isImageKind("page"));
});

add_task(function test_languages() {
  const translate = BUILTIN_PROMPTS.find(prompt => prompt.id == "translate");
  Assert.ok(usesLanguage(translate), "translating uses the language");
  Assert.ok(
    !usesLanguage(BUILTIN_PROMPTS.find(prompt => prompt.id == "explain")),
    "explaining does not"
  );
  Assert.equal(labelOf(translate, "German"), "Translate to German");
  const byId = id => BUILTIN_PROMPTS.find(prompt => prompt.id == id);
  for (const id of ["explain", "summarize-page", "key-points", "describe"]) {
    Assert.ok(namesLanguage(byId(id)), `${id} names the language`);
    Assert.ok(!usesLanguage(byId(id)), `but ${id} does not translate`);
    Assert.ok(
      render(byId(id).prompt, { lang: "Indonesian" }).endsWith(
        "Answer in Indonesian."
      ),
      `${id} answers in it`
    );
  }
  const values = templateValues({
    text: "Hi",
    title: "T",
    url: "https://example.com/",
    page: "body",
    lang: "Indonesian",
  });
  Assert.ok(
    render(byId("summarize-page").prompt, values).startsWith(
      "Summarize this page in a few short bullet points. Write the answer in Indonesian.\n"
    ),
    "the instruction says the language, where the chat reads it first"
  );
  Assert.ok(
    render(byId("explain").prompt, values).startsWith(
      "Explain this in plain words, in Indonesian:\n"
    ),
    "an instruction ending in a colon takes it before the colon"
  );
  Assert.equal(
    labelOf(byId("summarize-page"), "Indonesian"),
    "Summarize Page in Indonesian"
  );
  for (const id of ["rewrite", "grammar", "reply", "ocr", "tone-formal"]) {
    Assert.ok(
      !namesLanguage(byId(id)) && !byId(id).prompt.includes("{{lang}}"),
      `${id} keeps the text's own language`
    );
  }
  Assert.equal(languageName("id"), "Indonesian");
  Assert.deepEqual(parseRecentLanguages("de, fr,,bad code,ja"), [
    "de",
    "fr",
    "ja",
  ]);
  Assert.deepEqual(withRecentLanguage(["de", "fr"], "fr"), ["fr", "de"]);
  Assert.equal(
    withRecentLanguage(["a1", "b", "c", "d", "e"], "f").length,
    5,
    "five are kept"
  );
  const choices = languageChoices(["de"], "id");
  Assert.equal(choices[0], "de", "the one used last is first");
  Assert.equal(choices[1], "id", "then the browser's own");
  Assert.equal(new Set(choices).size, choices.length, "each once");
});
