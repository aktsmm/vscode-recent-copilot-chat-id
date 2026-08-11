import assert from "node:assert/strict";
import test from "node:test";
import { renderSessionInspectorHtml } from "../src/session-inspector-html";
import { buildSessionInspectorModel } from "../src/session-inspector-model";

const translate = (message: string, ...args: string[]): string =>
  args.reduce(
    (text, value, index) => text.replaceAll(`{${index}}`, value),
    message,
  );

test("renderSessionInspectorHtml escapes values and disables scripts", () => {
  const html = renderSessionInspectorHtml(
    {
      locale: "ja",
      title: '<script>alert("title")</script>',
      fields: [
        { group: "Group <x>", label: "ID <unsafe>", value: 'value & "quoted"' },
      ],
      note: "local-only",
    },
    "fixed-nonce",
  );

  assert.match(html, /<html lang="ja">/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /style-src 'nonce-fixed-nonce'/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(
    html,
    /&lt;script&gt;alert\(&quot;title&quot;\)&lt;\/script&gt;/,
  );
  assert.match(html, /ID &lt;unsafe&gt;/);
  assert.match(html, /value &amp; &quot;quoted&quot;/);
  assert.match(html, /<h2>Group &lt;x&gt;<\/h2>/);
  assert.match(
    html,
    /<title>&lt;script&gt;alert\(&quot;title&quot;\)&lt;\/script&gt;<\/title>/,
  );
});

test("renderSessionInspectorHtml groups consecutive fields into one section", () => {
  const html = renderSessionInspectorHtml(
    {
      locale: "en-US",
      title: "Session",
      fields: [
        { group: "Session", label: "Session ID", value: "id" },
        { group: "Session", label: "Title source", value: "Session ID" },
        { group: "Timing", label: "Last saved", value: "now" },
      ],
      note: "local-only",
    },
    "fixed-nonce",
  );

  assert.equal(html.match(/<section>/g)?.length, 2);
  assert.equal(html.match(/<dl>/g)?.length, 2);
  assert.match(
    html,
    /<h2>Session<\/h2><dl><dt>Session ID<\/dt><dd>id<\/dd><dt>Title source<\/dt>/,
  );
});

test("every inspector group renders exactly once as one contiguous section", () => {
  for (const usage of [
    undefined,
    { kind: "analyzing" } as const,
    { kind: "error", errorCode: "SessionUsageMalformedJson" } as const,
    {
      kind: "ok",
      sourceModifiedAt: Date.UTC(2026, 7, 6, 10, 6),
      summary: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        requestCount: 1,
        aiCredits: 1.5,
        models: [],
      },
    } as const,
  ]) {
    const model = buildSessionInspectorModel(
      {
        id: "11111111-1111-4111-8111-111111111111",
        modifiedAt: Date.UTC(2026, 7, 6, 10, 5),
        displayTitle: "Session 11111111",
        titleSource: "id",
      },
      "en-US",
      translate,
      usage,
    );
    const html = renderSessionInspectorHtml(model, "fixed-nonce");
    const headings = [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(headings, ["Session", "Timing", "Edits", "Usage"]);
  }
});
