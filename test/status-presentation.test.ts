import assert from "node:assert/strict";
import test from "node:test";
import {
  describeRecordStatus,
  describeSessionStatus,
  describeUnavailableStatus,
  RecentChatStatus,
} from "../src/status-presentation";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

const ALL_STATUSES: RecentChatStatus[] = [
  describeSessionStatus([]),
  describeSessionStatus([
    { id: FIRST_ID, modifiedAt: 300 },
    { id: SECOND_ID, modifiedAt: 300 },
  ]),
  describeSessionStatus([{ id: FIRST_ID, modifiedAt: 300 }]),
  describeUnavailableStatus(),
];

test("describeSessionStatus maps saved sessions to status bar states", () => {
  assert.equal(describeSessionStatus([]).kind, "empty");
  assert.equal(
    describeSessionStatus([
      { id: FIRST_ID, modifiedAt: 300 },
      { id: SECOND_ID, modifiedAt: 300 },
    ]).kind,
    "ambiguous",
  );

  const recent = describeSessionStatus([
    { id: FIRST_ID, modifiedAt: 300 },
    { id: SECOND_ID, modifiedAt: 200 },
  ]);
  assert.equal(recent.kind, "recent");
  assert.match(recent.text, /Recent Chat: 11111111$/);
  assert.match(recent.tooltip, new RegExp(FIRST_ID));
});

test("every status keeps one status bar identity", () => {
  for (const status of ALL_STATUSES) {
    assert.match(
      status.text,
      /^\$\((comment-discussion|warning)\) Recent Chat: /,
      `Inconsistent label for ${status.kind}: ${status.text}`,
    );
  }
});

test("saved session count is surfaced when sessions exist", () => {
  assert.match(
    describeSessionStatus([{ id: FIRST_ID, modifiedAt: 300 }]).tooltip,
    /1 saved session ID in this window\./,
  );
  assert.match(
    describeSessionStatus([
      { id: FIRST_ID, modifiedAt: 300 },
      { id: SECOND_ID, modifiedAt: 300 },
    ]).tooltip,
    /2 saved session IDs in this window\./,
  );
});

test("status labels never claim the active session", () => {
  for (const status of ALL_STATUSES) {
    assert.doesNotMatch(
      `${status.text} ${status.ariaLabel} ${status.tooltip}`,
      /current session|active session id|99\.9%/i,
    );
  }
});

test("screen reader labels stay free of codicon markup", () => {
  for (const status of ALL_STATUSES) {
    assert.doesNotMatch(status.ariaLabel, /\$\(/);
    assert.ok(status.ariaLabel.length > 0, `Missing label for ${status.kind}`);
  }
});

test("every status explains the click action", () => {
  for (const status of ALL_STATUSES) {
    assert.match(status.ariaLabel, /Activate to /);
    assert.match(status.tooltip, /Select to /);
  }
});

test("only the recent status exposes a full session ID", () => {
  assert.doesNotMatch(
    describeUnavailableStatus().tooltip,
    new RegExp(FIRST_ID),
  );
  assert.doesNotMatch(describeSessionStatus([]).tooltip, new RegExp(FIRST_ID));
});

test("record status shows the title and opens the session list", () => {
  const status = describeRecordStatus([
    {
      id: FIRST_ID,
      modifiedAt: 300,
      displayTitle: "Authentication failure",
      titleSource: "metadata",
    },
  ]);
  assert.equal(
    status.text,
    "$(comment-discussion) Recent: Authentication failure",
  );
  assert.match(status.tooltip, /Select to show it in the session list/);
  assert.match(status.ariaLabel, /Activate to show it in the session list/);
});
