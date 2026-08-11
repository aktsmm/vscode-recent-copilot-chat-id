import assert from "node:assert/strict";
import test from "node:test";
import {
  canAnalyzeOnInspectorOpen,
  shouldApplyInspectorUsage,
} from "../src/inspector-usage-gate";

const BOTH = { usageReadingEnabled: true, analyzeOnOpenEnabled: true };

test("canAnalyzeOnInspectorOpen requires both opt-ins and a session directory", () => {
  assert.equal(canAnalyzeOnInspectorOpen(BOTH, true), true);
  assert.equal(canAnalyzeOnInspectorOpen(BOTH, false), false);
  assert.equal(
    canAnalyzeOnInspectorOpen(
      { usageReadingEnabled: false, analyzeOnOpenEnabled: true },
      true,
    ),
    false,
  );
  assert.equal(
    canAnalyzeOnInspectorOpen(
      { usageReadingEnabled: true, analyzeOnOpenEnabled: false },
      true,
    ),
    false,
  );
  assert.equal(
    canAnalyzeOnInspectorOpen(
      { usageReadingEnabled: false, analyzeOnOpenEnabled: false },
      true,
    ),
    false,
  );
});

test("shouldApplyInspectorUsage accepts only a live, opted-in result", () => {
  assert.equal(
    shouldApplyInspectorUsage(BOTH, {
      cancelled: false,
      staleGeneration: false,
    }),
    true,
  );
  assert.equal(
    shouldApplyInspectorUsage(BOTH, {
      cancelled: false,
      staleGeneration: false,
      errorCode: "SessionUsageUnsupportedSchema",
    }),
    true,
  );
});

test("shouldApplyInspectorUsage drops cancelled, superseded, and opted-out results", () => {
  assert.equal(
    shouldApplyInspectorUsage(BOTH, {
      cancelled: true,
      staleGeneration: false,
    }),
    false,
  );
  assert.equal(
    shouldApplyInspectorUsage(BOTH, {
      cancelled: false,
      staleGeneration: true,
    }),
    false,
  );
  assert.equal(
    shouldApplyInspectorUsage(BOTH, {
      cancelled: false,
      staleGeneration: false,
      errorCode: "SessionUsageCancelled",
    }),
    false,
  );
  for (const settings of [
    { usageReadingEnabled: false, analyzeOnOpenEnabled: true },
    { usageReadingEnabled: true, analyzeOnOpenEnabled: false },
    { usageReadingEnabled: false, analyzeOnOpenEnabled: false },
  ]) {
    assert.equal(
      shouldApplyInspectorUsage(settings, {
        cancelled: false,
        staleGeneration: false,
      }),
      false,
    );
  }
});
