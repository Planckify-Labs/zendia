// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What CAPTCHAs look like to the browser, and the arithmetic for solving one
// with the keyboard alone. Which frames are CAPTCHAs, by their address: the
// agent hands them to the user, and a jump stays open in the ones that ask
// for several clicks. Pointer and label arithmetic is here too, without any
// DOM, so it can be tested alone.
//
// The detection reads four signals. The address of a frame (CAPTCHAS); the
// address of a loader script (SCRIPTS), the only sign of the invisible and
// scored ones, which draw nothing of their own; the widgets a page draws
// itself (WIDGETS); and the answer field a solved one leaves in the form
// (TOKEN_FIELDS). A challenge a page draws itself, with none of those, is
// known by what it asks (CHALLENGE_PROMPTS). Each service is filed under
// the kind of check it is (KINDS), so what is found can be grouped the way
// the survey of CAPTCHAs groups them.

// The kinds of check a service can ask for, after the survey of the field:
// read a distorted text, pick the images, drag a slider, play a little
// game, prove some work; the invisible, scored and managed ones ask nothing
// and decide from what they see. "behavioral" and "sensor" do not ask at
// all — they only watch — but the same signals find them, and a survey of a
// page is incomplete without them. "honeypot" and "timing" are traps of the
// form itself rather than a service's.
const KINDS = [
  "text",
  "image",
  "audio",
  "math",
  "word",
  "video",
  "checkbox",
  "invisible",
  "score",
  "slider",
  "puzzle",
  "rotate",
  "click",
  "icon",
  "game",
  "behavioral",
  "sensor",
  "biometric",
  "proof-of-work",
  "managed",
  "risk",
  "hybrid",
  "honeypot",
  "timing",
];

// `challenge` tells the frame that asks for clicks (a grid of images to
// pick from) from the ones that only host a checkbox or a badge. Without
// it, the whole service is a challenge. `kind` is what the challenge asks
// of the visitor, `widgetKind` what the checkbox is when it is not one, and
// `score` marks the address of a scored integration (reCAPTCHA v3's
// api.js?render=<site key>), which never draws a widget at all.
const CAPTCHAS = [
  {
    name: "reCAPTCHA",
    frame: /google\.com\/recaptcha\/|recaptcha\.net\//,
    challenge: /\/bframe/,
    kind: "image",
    widgetKind: "checkbox",
    // render=explicit and render=onload are still v2's checkbox.
    score: /[?&]render=(?!(?:explicit|onload)\b)/,
  },
  {
    name: "hCaptcha",
    frame: /hcaptcha\.com\//,
    challenge: /frame=challenge/,
    kind: "image",
    widgetKind: "checkbox",
  },
  {
    name: "Cloudflare Turnstile",
    // The managed challenge is served from the site's own address too.
    frame: /challenges\.cloudflare\.com\/|\/cdn-cgi\/challenge-platform\//,
    challenge: null,
    kind: "managed",
  },
  {
    name: "Arkose",
    frame: /arkoselabs\.com\/|funcaptcha\.com\/|octocaptcha\.com\//,
    challenge: /./,
    kind: "game",
  },
  {
    name: "GeeTest",
    frame: /geetest\.com\/|geevisit\.com\/|geetest\.cn\//,
    challenge: /./,
    kind: "slider",
  },
  {
    // The "Press & Hold" button and its puzzles.
    name: "HUMAN",
    frame:
      /px-cdn\.net\/|px-cloud\.net\/|perimeterx\.(?:net|com)\/|human\.com\/captcha/,
    challenge: /./,
    kind: "behavioral",
  },
  {
    // The captcha frame is captcha-delivery's; datadome.co serves the
    // watching script, which is found under SCRIPTS.
    name: "DataDome",
    frame: /captcha-delivery\.com\//,
    challenge: /./,
    kind: "slider",
  },
  {
    name: "Yandex SmartCaptcha",
    frame: /smartcaptcha\.yandexcloud\.net\/|captcha\.yandex\./,
    challenge: /advanced/,
    kind: "puzzle",
    widgetKind: "checkbox",
  },
  {
    name: "Tencent Captcha",
    frame: /captcha\.qcloud\.com\/|turing\.captcha\.gtimg\.com\//,
    challenge: /./,
    kind: "slider",
  },
  {
    name: "NetEase Yidun",
    frame: /(?:c|captcha)\.dun\.163\.com\//,
    challenge: /./,
    kind: "slider",
  },
  {
    name: "MTCaptcha",
    frame: /mtcaptcha\.com\//,
    challenge: null,
    kind: "text",
  },
  {
    // v2's widget and its hidden agent are frames of frcapi.com (global. or
    // eu.); v1 draws in the page and only fetches its puzzle from the API.
    // friendlycaptcha.com itself is the company's site, not the CAPTCHA.
    name: "Friendly Captcha",
    frame: /\bfrcapi\.com\/|\b(?:eu-)?api\.friendlycaptcha\.(?:com|eu)\//,
    challenge: null,
    kind: "proof-of-work",
  },
  { name: "AWS WAF", frame: /awswaf\.com\//, challenge: /./, kind: "puzzle" },
  {
    name: "Lemin",
    frame: /leminnow\.com\//,
    challenge: /./,
    kind: "puzzle",
  },
  {
    name: "KeyCAPTCHA",
    frame: /keycaptcha\.com\//,
    challenge: /./,
    kind: "puzzle",
  },
];

// The CAPTCHAs that are not a frame of their own, but part of the page: a
// widget that scripts draw in, or a page that is only a check. What is
// inside matches counts as the CAPTCHA's.
const WIDGETS = [
  ".g-recaptcha",
  ".grecaptcha-badge",
  ".h-captcha",
  ".cf-turnstile",
  ".frc-captcha",
  "#lemin-cropped-captcha",
  // Lemin's puzzle opens in a popup of its own, outside its checkbox.
  ".lemin-captcha-popup",
  "altcha-widget",
  ".altcha",
  ".mtcaptcha",
  "#mtcaptcha",
  ".mcaptcha__widget-container",
  "[class*='geetest_']",
  ".gt_holder",
  ".gt_popup",
  "[class*='yidun']",
  "[id*='tcaptcha']",
  "form[action*='validateCaptcha']",
  "#px-captcha",
  // A page that is only a check: the managed ones run under the site's own
  // address, so no frame gives them away.
  "#cf-challenge-running",
  "#challenge-stage",
  "#challenge-form",
  "#amzn-captcha-verify-button",
  // The puzzle AWS WAF shows once Begin is pressed, and its JS API's.
  ".amzn-captcha-modal",
  "awswaf-captcha",
].join(",");

// The widgets whose box is not to be clicked open: the proof-of-work and
// managed ones, where a click runs the check itself and shows no
// challenge (Friendly Captcha, ALTCHA, mCaptcha, Turnstile), the ones a
// text challenge shows from the start (MTCaptcha), and those that only
// hold a service's frames, whose checkbox is clicked inside its frame.
const NOT_OPENED = [
  ".frc-captcha",
  "altcha-widget",
  ".altcha",
  ".mcaptcha__widget-container",
  ".cf-turnstile",
  "#cf-challenge-running",
  "#challenge-stage",
  "#challenge-form",
  ".mtcaptcha",
  "#mtcaptcha",
  ".g-recaptcha",
  ".grecaptcha-badge",
  ".h-captcha",
].join(",");

// The loader scripts, by their address: the sign of the CAPTCHAs that draw
// nothing — the invisible and the scored ones — and of the services that
// only watch. A frame address says a CAPTCHA is shown; a script address
// says one is armed. Kasada serves its sensor from the site's own address
// as /ips.js; Akamai's has no steady address, so it cannot be told this
// way.
const SCRIPTS = [
  {
    name: "reCAPTCHA",
    // render=<site key> arms the scored v3, which never draws a widget.
    script: /recaptcha\/[^?]*\.js\?[^#]*\brender=(?!(?:explicit|onload)\b)/,
    kind: "score",
  },
  {
    name: "reCAPTCHA",
    script:
      /google\.com\/recaptcha\/|recaptcha\.net\/|gstatic\.com\/recaptcha\//,
    kind: "checkbox",
  },
  {
    name: "hCaptcha",
    script: /(?:js\.)?hcaptcha\.com\/1\/api\.js/,
    kind: "checkbox",
  },
  {
    name: "Cloudflare Turnstile",
    script: /challenges\.cloudflare\.com\/turnstile\//,
    kind: "managed",
  },
  {
    name: "Arkose",
    script: /arkoselabs\.com\/|funcaptcha\.com\//,
    kind: "game",
  },
  {
    // A site may serve GeeTest v4's loader itself, as gt4.js.
    name: "GeeTest",
    script: /geetest\.(?:com|cn)\/|geevisit\.com\/|\/gt4[\w.-]*\.js(?:[?#]|$)/,
    kind: "slider",
  },
  {
    name: "DataDome",
    script: /js\.datadome\.co\/tags\.js/,
    kind: "behavioral",
  },
  {
    name: "HUMAN",
    script: /px-cdn\.net\/|px-cloud\.net\//,
    kind: "behavioral",
  },
  { name: "AWS WAF", script: /awswaf\.com\//, kind: "puzzle" },
  {
    // v2's SDK (@friendlycaptcha/sdk, from a CDN or the API) and v1's
    // widget (friendly-challenge). Not every script of friendlycaptcha.com:
    // that is the company's own site.
    name: "Friendly Captcha",
    script:
      /@friendlycaptcha\/sdk|friendly-challenge|\bfrcapi\.com\/|\b(?:eu-)?api\.friendlycaptcha\.(?:com|eu)\//,
    kind: "proof-of-work",
  },
  { name: "Lemin", script: /leminnow\.com\//, kind: "puzzle" },
  {
    name: "ALTCHA",
    script: /\/altcha[@/.]/,
    kind: "proof-of-work",
  },
  {
    name: "MTCaptcha",
    script: /mtcaptcha\.com\//,
    kind: "text",
  },
  {
    name: "Yandex SmartCaptcha",
    script: /smartcaptcha\.yandexcloud\.net\/|captcha\.yandex\./,
    kind: "puzzle",
  },
  {
    name: "Kasada",
    script: /\/ips\.js(?:[?#]|$)/,
    kind: "sensor",
  },
];

// The services' names as a page's own words may give them away, for the
// code that has to take them out of a text (the CAPTCHA subagent's sterile
// task). The names that are also ordinary words of what a challenge asks
// ("HUMAN", whose widget says "Press & Hold") are left out: taking those
// out of the ask would cost the solver more than the name tells.
const AMBIGUOUS_NAMES = new Set(["HUMAN"]);

const NAMES = Object.freeze(
  [...new Set([...CAPTCHAS, ...SCRIPTS].map(({ name }) => name))].filter(
    name => !AMBIGUOUS_NAMES.has(name)
  )
);

// The field a solved CAPTCHA leaves in the form for the server to check:
// the one sign of it that stays on the page. A suffix names one of several
// on a page.
const TOKEN_FIELDS = [
  "g-recaptcha-response",
  "h-captcha-response",
  "cf-turnstile-response",
  "frc-captcha-solution",
  "frc-captcha-response",
  "mtcaptcha-verifiedtoken",
  "aws-waf-token",
  "fc-token",
  "altcha",
  "geetest_challenge",
  "geetest_validate",
  "geetest_seccode",
  "lemin_answer",
];

// The names a trap field gets: one a person never fills, for they never see
// it, and a simple script cannot resist. The timing trap — a form sent too
// fast — leaves nothing to find on the page, so there is no signal for it
// here.
const HONEYPOT_NAMES =
  /^(?:hp|honeypot|honey|sweet|website|homepage|url|link|email2|e-?mail2|fax|company|leave_?blank|do_?not_?fill|keep_?empty|comment_?hp)$/i;

// A CAPTCHA a site makes itself, a distorted text or a sum in a picture and
// a field for the answer, has no service to know it by: its picture and its
// field are known by their names (src, alt, id, class, name, placeholder).
// A logo of a CAPTCHA service is not one.
const OWN_CAPTCHA_NAMES =
  /captcha|security[\s_-]?code|verification[\s_-]?code|verify[\s_-]?code|anti[\s_-]?bot|human[\s_-]?check|enter (?:the )?(?:characters|code|text|letters|numbers) (?:you see|shown|above|below|in the (?:image|picture))/i;
const NOT_OWN_CAPTCHA = /logo|icon|badge|recaptcha-response|captcha-response/i;

// The website of a service, where its regexes would otherwise take every
// frame and script of the company's own pages for its CAPTCHA's.
const SERVICE_SITES =
  /^https?:\/\/www\.(?:hcaptcha|arkoselabs|geetest|mtcaptcha|friendlycaptcha|leminnow|keycaptcha)\.(?:com|cn|eu)\//;

// What a challenge says it asks, in the words the services and the sites
// that draw their own use: the one sign of a challenge with no service
// frame, script or class to know it by. Read from short texts only, so an
// article about CAPTCHAs is not one. The first rule that matches names the
// kind; the checkbox phrases, the weakest sign, are last.
const CHALLENGE_PROMPTS = [
  [
    "image",
    /^(?:please )?(?:select|click|tap|pick)(?: on)?(?: all| each| every| any)?(?: of)?(?: the)? (?:images?|squares?|pictures?|tiles?|photos?|boxes)\b/i,
  ],
  [
    "text",
    /^(?:please )?(?:type|enter)(?: in)?(?: the)? (?:characters?|letters?|text|code|words?|numbers?)\b.*\b(?:see|shown|image|picture|above|below)\b/i,
  ],
  [
    "slider",
    /^(?:please )?(?:slide|drag)\b.*\b(?:into place|gap|to (?:complete|fit|verify)|right)\b/i,
  ],
  ["rotate", /^(?:please )?(?:rotate|turn) the (?:image|picture|object)\b/i],
  [
    "click",
    /^(?:please )?(?:click|tap|select)(?: on)?(?: the)?(?: (?:icons?|characters?|symbols?|letters?|objects?))? in (?:the |this )?(?:following |given )?order\b/i,
  ],
  ["math", /^(?:what is|solve|calculate|how much is) \d+ ?[-+x×*÷/] ?\d+/i],
  ["behavioral", /^press (?:&|and) hold\b/i],
  [
    "checkbox",
    /^(?:i['’]?m|i am) (?:not a robot|a human|human)\.?$|^verify (?:that )?you(?:['’]re| are)(?: a)? human\.?$|^(?:are you a )?robot or human\??$|^click (?:here )?to verify\.?$/i,
  ],
];
// The words one of them starts with, for finding the texts to test without
// reading every text of the page.
const PROMPT_WORDS = [
  "select",
  "click",
  "tap",
  "pick",
  "type",
  "enter",
  "slide",
  "drag",
  "rotate",
  "turn",
  "robot",
  "human",
  "press",
  "what is",
  "solve",
  "calculate",
  "how much",
];
// The longest text a prompt can be.
const PROMPT_MAX = 120;

// What the controls of a challenge are for, beyond the images and pieces
// that labels pick: a key of its own reaches each of them, whatever label it
// has this time. They are told by what they say (aria-label, title, text)
// and then by their id and class, as every service names them its own way:
// reCAPTCHA's #recaptcha-reload-button, hCaptcha's .refresh, Arkose's
// "Restart", and so on. The first rule that matches wins, so "play" comes
// before "audio" (reCAPTCHA's play button sits in .rc-audiochallenge-*) and
// a download link of the audio is nothing to press for any of them.
//   answer  the field the answer is typed in: text, audio and math ones
//   play    plays the audio again
//   visual  back to the images from the audio
//   audio   the audio challenge, for who cannot see the images
//   reload  another challenge
//   verify  checks what was picked: Verify, Next, Skip, Submit
const PURPOSES = ["answer", "play", "visual", "audio", "reload", "verify"];
const NOT_A_PURPOSE = /download|help|privacy|terms|report|feedback|logo/i;
const PURPOSE_RULES = [
  ["play", /\bplay\b|\breplay\b|listen again|play-?button/i],
  [
    "visual",
    /\bvisual\b|image-?button|get an? (?:image|picture)|(?:image|picture) challenge instead/i,
  ],
  ["audio", /\baudio\b|\blisten\b|headphone|\bsound\b|\bvoice\b/i],
  [
    "reload",
    /reload|refresh|new challenge|another challenge|try another|try again|start over|restart|^reset\b|new (?:image|picture|puzzle|question)s?\b/i,
  ],
  [
    "verify",
    /\bverify\b|\bsubmit\b|^next\b|\bskip\b|^check\b|\bconfirm\b|^done\b|^continue\b|^ok\b|verify-?button|button-?submit/i,
  ],
];
// The fields an answer is typed in; a checkbox or a button is none.
const ANSWER_TYPES = new Set([
  "",
  "text",
  "search",
  "tel",
  "number",
  "email",
  "url",
]);

// The service a frame address is a CAPTCHA's, if any; and the loader a
// script address is. Neither on a service's own website.
function serviceOf(url) {
  url = String(url);
  return SERVICE_SITES.test(url)
    ? null
    : (CAPTCHAS.find(({ frame }) => frame.test(url)) ?? null);
}

function loaderOf(url) {
  url = String(url);
  return SERVICE_SITES.test(url)
    ? null
    : (SCRIPTS.find(({ script }) => script.test(url)) ?? null);
}

export const ZendiaCaptcha = {
  KINDS,
  NAMES,
  WIDGETS,
  NOT_OPENED,
  PROMPT_WORDS,
  PROMPT_MAX,

  /**
   * @param {string} url The address of a frame.
   * @returns {string|null} The service it belongs to, if it is a CAPTCHA's.
   */
  nameOf(url) {
    return serviceOf(url)?.name ?? null;
  },

  /**
   * @param {string} url The address of a frame.
   * @returns {boolean} Whether it is the part of a CAPTCHA that asks for
   *   clicks, rather than the checkbox that opens it.
   */
  isChallenge(url) {
    return !!serviceOf(url)?.challenge?.test(url);
  },

  /**
   * @param {string} url The address of a frame or of a script.
   * @returns {string|null} The kind of check it asks for, one of KINDS, if
   *   it is a CAPTCHA's.
   */
  kindOf(url) {
    const captcha = serviceOf(url);
    if (!captcha) {
      return ZendiaCaptcha.kindOfScript(url);
    }
    if (captcha.score?.test(url)) {
      return "score";
    }
    if (!captcha.challenge) {
      return captcha.kind;
    }
    return captcha.challenge.test(url)
      ? captcha.kind
      : (captcha.widgetKind ?? captcha.kind);
  },

  /**
   * @param {string} url The address of a script.
   * @returns {string|null} The service it loads, if it is a CAPTCHA's.
   */
  nameOfScript(url) {
    return loaderOf(url)?.name ?? null;
  },

  /**
   * @param {string} url The address of a script.
   * @returns {string|null} The kind of check it arms, one of KINDS.
   */
  kindOfScript(url) {
    return loaderOf(url)?.kind ?? null;
  },

  /**
   * What a short text of a page asks, if it is the prompt of a challenge:
   * "Select all images with crosswalks", "Slide the piece into place",
   * "I'm not a robot". The sign of a challenge a page draws itself.
   *
   * @param {string} text
   * @returns {string|null} The kind it asks for, one of KINDS.
   */
  promptKind(text) {
    text = String(text).replace(/\s+/g, " ").trim();
    if (!text || text.length > PROMPT_MAX) {
      return null;
    }
    return CHALLENGE_PROMPTS.find(([, rule]) => rule.test(text))?.[0] ?? null;
  },

  /**
   * @param {string} name The name of a form field.
   * @returns {boolean} Whether it is the one a CAPTCHA leaves its answer in.
   */
  isTokenField(name) {
    const field = String(name).toLowerCase();
    return TOKEN_FIELDS.some(
      token =>
        field === token ||
        field.startsWith(token + "-") ||
        field.startsWith(token + "[")
    );
  },

  /**
   * A field a person cannot fill is a trap for a script: hidden, and named
   * to be filled. A hint, not a verdict.
   *
   * @param {string} name The name of a form field.
   * @param {{visible?: boolean}} [field] Whether the field can be seen.
   * @returns {boolean}
   */
  isHoneypotField(name, { visible = true } = {}) {
    return !visible && HONEYPOT_NAMES.test(String(name));
  },

  PURPOSES,

  /**
   * Whether the names of a picture or a field say it is part of a CAPTCHA
   * the site makes itself: a text or a sum to read, and a field to type it in.
   *
   * @param {string} names Its src, alt, id, class, name, placeholder and
   *   aria-label, together.
   * @returns {boolean}
   */
  namesOwnCaptcha(names) {
    const text = String(names).slice(0, 1000);
    return OWN_CAPTCHA_NAMES.test(text) && !NOT_OWN_CAPTCHA.test(text);
  },

  /**
   * What a control of a CAPTCHA is for, so a key of its own can press it:
   * the challenge's labels change with every challenge, its buttons do not.
   *
   * @param {object} control Plain data about it, read from the DOM.
   * @param {string} [control.tag] Its local name.
   * @param {string} [control.type] An input's type.
   * @param {boolean} [control.editable] Whether it takes typing.
   * @param {string} [control.label] What it says: aria-label, title, text.
   * @param {string} [control.name] Its id and class.
   * @returns {string|null} One of PURPOSES, or null for the images, the
   *   checkbox and everything else.
   */
  purposeOf({ tag = "", type = "", editable = false, label = "", name = "" }) {
    tag = String(tag).toLowerCase();
    type = String(type).toLowerCase();
    if (
      editable &&
      tag != "select" &&
      (tag != "input" || ANSWER_TYPES.has(type))
    ) {
      return "answer";
    }
    if (tag == "input" && (type == "checkbox" || type == "radio")) {
      return null;
    }
    label = String(label).replace(/\s+/g, " ").trim().slice(0, 200);
    // ids and classes are words joined by dashes and underscores.
    name = String(name)
      .replace(/[_\s]+/g, " ")
      .slice(0, 200);
    if (NOT_A_PURPOSE.test(label) || NOT_A_PURPOSE.test(name)) {
      return null;
    }
    for (const text of [label, name]) {
      for (const [purpose, rule] of PURPOSE_RULES) {
        if (text && rule.test(text)) {
          return purpose;
        }
      }
    }
    return null;
  },

  /**
   * Labels that stay with their targets as the targets come and go: a
   * CAPTCHA changes under the user's eyes, and a label that moved between
   * two looks would be pressed by mistake. A target that had a label keeps
   * it while no other target has it; the rest take the labels left, all of
   * one length so that no label starts another.
   *
   * @param {*[]} keys What identifies each target, in the order they are
   *   labeled.
   * @param {Map<*, string>} kept The label each target had.
   * @param {string} alphabet The letters labels are made of.
   * @returns {string[]} A label per key.
   */
  stickyLabels(keys, kept, alphabet) {
    const letters = [...alphabet];
    const known = keys.map(key => kept.get(key) ?? null);
    const lengths = new Set(known.filter(Boolean).map(label => label.length));
    // What was kept cannot be mixed with labels of another length: start over.
    const length = lengths.size == 1 ? [...lengths][0] : null;
    const reuse = length !== null;
    const size = length ?? (keys.length <= letters.length ? 1 : 2);
    const labels = Array(keys.length).fill(null);
    const used = new Set();
    if (reuse) {
      known.forEach((label, i) => {
        if (label && !used.has(label)) {
          labels[i] = label;
          used.add(label);
        }
      });
    }
    const candidates = function* () {
      if (size == 1) {
        yield* letters;
      } else {
        for (const first of letters) {
          for (const second of letters) {
            yield first + second;
          }
        }
      }
    };
    const free = candidates();
    for (let i = 0; i < labels.length; i++) {
      if (labels[i]) {
        continue;
      }
      let next = free.next();
      while (!next.done && used.has(next.value)) {
        next = free.next();
      }
      if (next.done) {
        break;
      }
      labels[i] = next.value;
      used.add(next.value);
    }
    return labels;
  },

  /**
   * Labels of one length for `count` targets, from `letters`: one letter
   * each while they last, then two, and so on, so no label starts another.
   *
   * @param {number} count
   * @param {string} letters
   * @returns {string[]}
   */
  labelsOf(count, letters) {
    let labels = [...letters];
    while (labels.length < count) {
      labels = labels.flatMap(first => [...letters].map(next => first + next));
    }
    return labels.slice(0, count);
  },

  /**
   * The stops of a slider's ruler: where its piece can be put, evenly along
   * the way the handle can still go. A slider moves its piece as far as its
   * handle, so a stop is a place for the piece, and the handle goes as far.
   *
   * @param {{x: number}} piece Where the piece is now (the handle, if no
   *   piece is known).
   * @param {{left: number, width: number}} handle
   * @param {{left: number, width: number}} area The challenge it slides in.
   * @param {number} count How many stops.
   * @returns {number[]} The x of each stop, left to right; none if the
   *   handle has no room to go.
   */
  rulerStops(piece, handle, area, count) {
    const room = area.left + area.width - (handle.left + handle.width);
    if (!(room >= count) || count < 1) {
      return [];
    }
    const step = room / count;
    return Array.from({ length: count }, (_, i) => piece.x + step * (i + 1));
  },

  /**
   * A count typed before a key, as vim takes one: digits, never more than
   * `max`. A leading 0 is no count.
   *
   * @param {string} count The digits so far.
   * @param {string} digit The one typed.
   * @param {number} [max]
   * @returns {string} The digits now.
   */
  growCount(count, digit, max = 999) {
    if (!/^\d$/.test(digit) || (!count && digit == "0")) {
      return count;
    }
    const grown = count + digit;
    return Number(grown) > max ? String(max) : grown;
  },

  /**
   * A grid over an area, for clicking where nothing has a label: the CAPTCHAs
   * that draw their picture in a canvas.
   *
   * @param {{left: number, top: number, width: number, height: number}} area
   * @param {number} cell About how wide and tall a cell should be.
   * @returns {{left: number, top: number, width: number, height: number}[]}
   *   The cells, row by row. The cells are as many as the area holds, and
   *   fill it exactly.
   */
  gridCells(area, cell) {
    const columns = Math.max(1, Math.round(area.width / cell));
    const rows = Math.max(1, Math.round(area.height / cell));
    return ZendiaCaptcha.splitRect(area, columns, rows);
  },

  /**
   * @param {{left: number, top: number, width: number, height: number}} rect
   * @param {number} columns
   * @param {number} rows
   * @returns {{left: number, top: number, width: number, height: number}[]}
   *   The parts, row by row.
   */
  splitRect(rect, columns, rows) {
    const width = rect.width / columns;
    const height = rect.height / rows;
    const parts = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        parts.push({
          left: rect.left + column * width,
          top: rect.top + row * height,
          width,
          height,
        });
      }
    }
    return parts;
  },

  /**
   * @param {{left: number, top: number, width: number, height: number}} rect
   * @returns {{x: number, y: number}} Its middle.
   */
  middle(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  },

  /**
   * The board a set of pieces sit on, when they sit on one: a CAPTCHA that
   * asks for pieces to be moved onto the empty places of a board draws the
   * places as nothing a script can point at, but the pieces show where the
   * lines of the board are and how far apart.
   *
   * @param {{left: number, top: number, width: number, height: number}[]}
   *   pieces
   * @returns {{left: number, top: number, width: number, height: number}[]|null}
   *   Every place of the board, row by row, or null if the pieces do not
   *   sit on a regular one.
   */
  lattice(pieces) {
    if (pieces.length < 3) {
      return null;
    }
    const axis = values => {
      const sorted = [...values].sort((a, b) => a - b);
      const lines = [];
      for (const value of sorted) {
        if (!lines.length || value - lines[lines.length - 1] > 4) {
          lines.push(value);
        }
      }
      return lines;
    };
    const centers = pieces.map(ZendiaCaptcha.middle);
    const xs = axis(centers.map(point => point.x));
    const ys = axis(centers.map(point => point.y));
    const gaps = lines => lines.slice(1).map((line, i) => line - lines[i]);
    const pitches = [...gaps(xs), ...gaps(ys)];
    if (!pitches.length) {
      return null;
    }
    const pitch = Math.min(...pitches);
    // A piece the board cannot hold the size of is not on it.
    const fits = lines =>
      lines.every(line => {
        const steps = (line - lines[0]) / pitch;
        return Math.abs(steps - Math.round(steps)) < 0.2;
      });
    if (pitch < 12 || !fits(xs) || !fits(ys)) {
      return null;
    }
    const width = pieces[0].width;
    const height = pieces[0].height;
    const columns = Math.round((xs[xs.length - 1] - xs[0]) / pitch) + 1;
    const rows = Math.round((ys[ys.length - 1] - ys[0]) / pitch) + 1;
    if (columns < 2 && rows < 2) {
      return null;
    }
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        cells.push({
          left: xs[0] + column * pitch - width / 2,
          top: ys[0] + row * pitch - height / 2,
          width,
          height,
        });
      }
    }
    return cells;
  },

  /**
   * The points between two, a few pixels apart: a drag is a path the page can
   * follow, not a jump, and a slider that only reads the last move would
   * still end where it should.
   *
   * @param {{x: number, y: number}} from
   * @param {{x: number, y: number}} to
   * @param {number} step The most a move may cover.
   * @returns {{x: number, y: number}[]} The points after `from`, up to and
   *   including `to`.
   */
  path(from, to, step) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(length / step));
    return Array.from({ length: count }, (_, i) => ({
      x: from.x + ((to.x - from.x) * (i + 1)) / count,
      y: from.y + ((to.y - from.y) * (i + 1)) / count,
    }));
  },
};
