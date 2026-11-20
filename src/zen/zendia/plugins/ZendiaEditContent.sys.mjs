// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";

// The editor's own commands keep undo history and fire input events, so
// pages see these edits like typing.
function editorCommand(command) {
  return ({ actor, document }) => {
    if (
      ZendiaDom.isEditable(ZendiaDom.deepActiveElement(document)) &&
      actor.docShell.isCommandEnabled(command)
    ) {
      actor.docShell.doCommand(command);
    }
  };
}

// The editor command of each action, which the browser's own fields (the
// urlbar, a search box) run too.
export const EDIT_COMMANDS = {
  "edit.deleteWordBackward": "cmd_deleteWordBackward",
  "edit.deleteToLineStart": "cmd_deleteToBeginningOfLine",
  "edit.deleteCharBackward": "cmd_deleteCharBackward",
  "edit.deleteCharForward": "cmd_deleteCharForward",
  "edit.deleteToLineEnd": "cmd_deleteToEndOfLine",
};

export const actions = Object.fromEntries(
  Object.entries(EDIT_COMMANDS).map(([id, command]) => [
    id,
    editorCommand(command),
  ])
);
