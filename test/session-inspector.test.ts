import assert from "node:assert/strict";
import test from "node:test";
import { renderSessionInspectorHtml } from "../src/session-inspector-html";

test("renderSessionInspectorHtml escapes values and disables scripts", () => {
  const html = renderSessionInspectorHtml(
    {
      locale: "ja",
      title: '<script>alert("title")</script>',
      fields: [{ label: "ID <unsafe>", value: 'value & "quoted"' }],
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
});
