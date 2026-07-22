#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { terminateChildProcess } from "./process-lifecycle.mjs";

class FakeChild extends EventEmitter {
  constructor(mode) {
    super();
    this.mode = mode;
    this.exitCode = null;
    this.signalCode = null;
    this.signals = [];
  }

  kill(signal) {
    this.signals.push(signal);
    if (this.mode === "graceful" && signal === "SIGTERM") {
      queueMicrotask(() => {
        this.signalCode = signal;
        this.emit("exit", null, signal);
      });
    }
    if (this.mode === "forced" && signal === "SIGKILL") {
      queueMicrotask(() => {
        this.signalCode = signal;
        this.emit("exit", null, signal);
      });
    }
    return true;
  }
}

const graceful = new FakeChild("graceful");
await terminateChildProcess(graceful, {
  label: "graceful fixture",
  gracefulMs: 25,
  forceMs: 25,
});
assert.deepEqual(graceful.signals, ["SIGTERM"]);

const forced = new FakeChild("forced");
await terminateChildProcess(forced, {
  label: "forced fixture",
  gracefulMs: 5,
  forceMs: 25,
});
assert.deepEqual(forced.signals, ["SIGTERM", "SIGKILL"]);

const stubborn = new FakeChild("stubborn");
await assert.rejects(
  terminateChildProcess(stubborn, {
    label: "stubborn fixture",
    gracefulMs: 5,
    forceMs: 5,
  }),
  /did not exit after forced shutdown/,
);
assert.deepEqual(stubborn.signals, ["SIGTERM", "SIGKILL"]);

const exited = new FakeChild("stubborn");
exited.exitCode = 0;
await terminateChildProcess(exited, {
  label: "already exited fixture",
  gracefulMs: 5,
  forceMs: 5,
});
assert.deepEqual(exited.signals, []);

console.log(
  JSON.stringify({ ok: true, gate: "process-lifecycle", cases: 4 }, null, 2),
);
