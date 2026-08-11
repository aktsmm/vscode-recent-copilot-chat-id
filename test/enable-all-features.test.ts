import assert from "node:assert/strict";
import test from "node:test";
import { enableAllLocalFeatures } from "../src/enable-all-features";

const SETTINGS = ["enabled", "readTitles", "readUsage", "analyzeOnOpen"];

function recordingPort(confirmed: boolean): {
  port: Parameters<typeof enableAllLocalFeatures>[1];
  enabled: string[];
  confirmCount: number;
} {
  const enabled: string[] = [];
  const state = { confirmCount: 0 };
  return {
    enabled,
    get confirmCount() {
      return state.confirmCount;
    },
    port: {
      confirm: async () => {
        state.confirmCount++;
        return confirmed;
      },
      enable: async (setting: string) => {
        enabled.push(setting);
      },
    },
  };
}

test("enableAllLocalFeatures enables nothing when the disclosure is declined", async () => {
  const recorder = recordingPort(false);
  assert.equal(await enableAllLocalFeatures(SETTINGS, recorder.port), false);
  assert.deepEqual(recorder.enabled, []);
  assert.equal(recorder.confirmCount, 1);
});

test("enableAllLocalFeatures enables every requested setting after consent", async () => {
  const recorder = recordingPort(true);
  assert.equal(await enableAllLocalFeatures(SETTINGS, recorder.port), true);
  assert.deepEqual(recorder.enabled, SETTINGS);
  assert.equal(recorder.confirmCount, 1);
});

test("enableAllLocalFeatures stops when a setting update fails", async () => {
  const enabled: string[] = [];
  await assert.rejects(
    enableAllLocalFeatures(SETTINGS, {
      confirm: async () => true,
      enable: async (setting) => {
        if (setting === "readUsage") {
          throw new Error("update failed");
        }
        enabled.push(setting);
      },
    }),
  );
  assert.deepEqual(enabled, ["enabled", "readTitles"]);
});
