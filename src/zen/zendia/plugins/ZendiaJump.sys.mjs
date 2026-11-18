// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Jump labels on a page: to any link, button or field by typing some of its
// text and then its label, or to a word or paragraph of the text, for visual
// mode to start from.

const CONTENT = "resource:///modules/zendia/plugins/ZendiaJumpContent.sys.mjs";

function jump(desc, params) {
  return {
    desc,
    where: "content",
    module: CONTENT,
    agent: false,
    ...(params && { params }),
  };
}

export const ZendiaJumpSpec = {
  name: "jump",
  actions: {
    "jump.controls": jump("Jump to a Link, Button or Field by its Text"),
    "jump.hints": jump("Label Every Link, Button and Field"),
    // Solving a CAPTCHA with the keys alone.
    // With orPage, a page whose CAPTCHA it cannot find is labeled whole.
    "jump.captcha": jump("Label the CAPTCHA to Solve it with the Keys", {
      orPage: "boolean?",
    }),
    // Its controls by what they do, whatever their labels.
    "captcha.verify": jump("Verify the CAPTCHA (Verify, Next, Skip)"),
    "captcha.answer": jump("Type the CAPTCHA's Answer"),
    "captcha.reload": jump("Get a New CAPTCHA Challenge"),
    "captcha.audio": jump("Switch the CAPTCHA to Audio, or Back to Images"),
    "captcha.play": jump("Play the CAPTCHA's Audio"),
    "jump.text": jump("Jump to a Word by its Letters"),
    "jump.words": jump("Label Every Word and Paragraph"),
    // Where visual mode starts, which `v` offers.
    "jump.land": jump("Choose Where Visual Mode Starts"),
  },
};
