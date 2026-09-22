import { describe, expect, it } from "vitest";

import { noteToHtml, noteToText } from "./noteHtml";

const IMAGE = "ledge://localhost/0199a000-0000-7000-8000-000000000001.png";
const embed = () => "data:image/png;base64,AAAA";
const drop = () => null;

/**
 * What another app receives. The rule is that nothing is invented and nothing is
 * lost: every shape the dialect can hold arrives as the nearest thing HTML has,
 * and anything that cannot travel says so rather than arriving broken.
 */
describe("a note as HTML", () => {
  it("writes the three headings, paragraphs and marks", () => {
    expect(noteToHtml("# Title\n\nSome **bold** and _soft_ text", drop)).toBe(
      "<h1>Title</h1>\n<p>Some <strong>bold</strong> and <em>soft</em> text</p>",
    );
    expect(noteToHtml("### Small", drop)).toBe("<h3>Small</h3>");
  });

  it("gathers consecutive list items into one list", () => {
    expect(noteToHtml("- milk\n- eggs", drop)).toBe("<ul><li>milk</li><li>eggs</li></ul>");
    expect(noteToHtml("1. wake\n2. coffee", drop)).toBe("<ol><li>wake</li><li>coffee</li></ol>");
    // A change of kind is a new list, which is what the text said.
    expect(noteToHtml("- milk\n1. first", drop)).toBe(
      "<ul><li>milk</li></ul>\n<ol><li>first</li></ol>",
    );
  });

  it("gives a checklist boxes a receiving app will keep", () => {
    // Not <input type=checkbox>: pasted into Notes it arrives dead or not at all.
    expect(noteToHtml("- [ ] milk\n- [x] eggs", drop)).toBe(
      "<ul><li>☐ milk</li><li>☑ eggs</li></ul>",
    );
  });

  it("keeps a code block as code, with its text untouched", () => {
    expect(noteToHtml("```python\na = 1 < 2\n```", drop)).toBe(
      "<pre><code>a = 1 &lt; 2</code></pre>",
    );
  });

  it("escapes anything that would otherwise be markup", () => {
    expect(noteToHtml("a <script>alert('x')</script> & co", drop)).toBe(
      "<p>a &lt;script&gt;alert('x')&lt;/script&gt; &amp; co</p>",
    );
  });

  it("embeds a picture when it can, and says so when it cannot", () => {
    expect(noteToHtml(`![the graph|320](${IMAGE})`, embed)).toBe(
      '<p><img src="data:image/png;base64,AAAA" alt="the graph" width="320"></p>',
    );
    expect(noteToHtml(`![the graph](${IMAGE})`, drop)).toBe("<p>[the graph]</p>");
    expect(noteToHtml(`![](${IMAGE})`, drop)).toBe("<p>[image]</p>");
  });

  it("writes a table as a table, which is what a table is for", () => {
    expect(noteToHtml("| Day | Cost |\n| --- | ---: |\n| Mon | 12 |", drop)).toBe(
      "<table><thead><tr><th>Day</th><th style=\"text-align:right\">Cost</th></tr></thead>" +
        "<tbody><tr><td>Mon</td><td style=\"text-align:right\">12</td></tr></tbody></table>",
    );
  });

  it("writes a bare link as a link", () => {
    expect(noteToHtml("see https://example.test/docs", drop)).toBe(
      '<p>see <a href="https://example.test/docs">https://example.test/docs</a></p>',
    );
  });
});

/** The plain-text half, for apps that take no formatting at all. */
describe("a note as text", () => {
  it("is the note itself, without links only this app can follow", () => {
    expect(noteToText(`Shopping\n![the graph|320](${IMAGE})\n- milk`)).toBe(
      "Shopping\n[the graph]\n- milk",
    );
    expect(noteToText(`![](${IMAGE})`)).toBe("[image]");
    expect(noteToText("**bold** stays as it was written")).toBe(
      "**bold** stays as it was written",
    );
  });
});
