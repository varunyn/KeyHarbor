import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCloseBehavior,
  WindowCloseController,
} from "../src/modules/window-close-controller";
import type { CloseChoice } from "../src/modules/window-close-controller";

test("window close honors the user's choice and remembers only explicit non-cancel decisions", async () => {
  for (const action of ["background", "quit", "cancel"] as const) {
    for (const remember of [false, true]) {
      const effects: string[] = [];
      const controller = new WindowCloseController({
        background: () => {
          effects.push("background");
        },
        choose: () => Promise.resolve({ action, remember }),
        getBehavior: () => "ask",
        isQuitting: () => false,
        quit: () => {
          effects.push("quit");
        },
        remember: (choice) => {
          effects.push(`remember:${choice}`);
        },
        reportError: (error) => {
          throw error;
        },
      });
      // eslint-disable-next-line no-await-in-loop -- Each independent user decision must settle before its effects are inspected.
      await controller.requestClose();
      assert.deepEqual(
        effects,
        action === "cancel"
          ? []
          : [...(remember ? [`remember:${action}`] : []), action]
      );
    }
  }
});

test("saved close choices skip the prompt and invalid preferences ask again", async () => {
  assert.equal(normalizeCloseBehavior("unknown"), "ask");
  assert.equal(normalizeCloseBehavior(null), "ask");
  for (const behavior of ["background", "quit"] as const) {
    const effects: string[] = [];
    const controller = new WindowCloseController({
      background: () => {
        effects.push("background");
      },
      choose: () => {
        throw new Error("saved preference should not prompt");
      },
      getBehavior: () => normalizeCloseBehavior(behavior),
      isQuitting: () => false,
      quit: () => {
        effects.push("quit");
      },
      remember: () => {
        throw new Error("already remembered");
      },
      reportError: (error) => {
        throw error;
      },
    });
    // eslint-disable-next-line no-await-in-loop -- Exercise each saved preference independently.
    await controller.requestClose();
    assert.deepEqual(effects, [behavior]);
  }
});

test("repeated close clicks share a decision and a concurrent application quit wins", async () => {
  let resolveChoice!: (choice: CloseChoice) => void;
  // eslint-disable-next-line promise/avoid-new -- Hold the native dialog decision while lifecycle events arrive.
  const choice = new Promise<CloseChoice>((resolve) => {
    resolveChoice = resolve;
  });
  let prompts = 0;
  let quitting = false;
  const effects: string[] = [];
  const controller = new WindowCloseController({
    background: () => {
      effects.push("background");
    },
    choose: () => {
      prompts += 1;
      return choice;
    },
    getBehavior: () => "ask",
    isQuitting: () => quitting,
    quit: () => {
      effects.push("quit");
    },
    remember: () => {
      effects.push("remember");
    },
    reportError: (error) => {
      throw error;
    },
  });
  const closing = controller.requestClose();
  await controller.requestClose();
  assert.equal(prompts, 1);
  quitting = true;
  resolveChoice({ action: "background", remember: true });
  await closing;
  await controller.requestClose();
  assert.deepEqual(effects, []);
  assert.equal(prompts, 1);
});

test("a failed preference save keeps the window available and permits a retry", async () => {
  let fail = true;
  const effects: string[] = [];
  const controller = new WindowCloseController({
    background: () => {
      effects.push("background");
    },
    choose: () => Promise.resolve({ action: "background", remember: true }),
    getBehavior: () => "ask",
    isQuitting: () => false,
    quit: () => {
      effects.push("quit");
    },
    remember: () => {
      if (fail) {
        throw new Error("disk unavailable");
      }
    },
    reportError: () => {
      effects.push("error");
    },
  });
  await controller.requestClose();
  assert.deepEqual(effects, ["error"]);
  fail = false;
  await controller.requestClose();
  assert.deepEqual(effects, ["error", "background"]);
});
