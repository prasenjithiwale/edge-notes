import { describe, expect, it } from "vitest";

import { findLanguage, highlight, LANGUAGES, languageLabel, tokenize, type TokenKind } from "./code";

/** The tokens of one kind, in order, so a test reads as what it is checking. */
function of(code: string, name: string, kind: TokenKind): string[] {
  return highlight(code, name)
    .filter((token) => token.kind === kind)
    .map((token) => token.text);
}

/** Everything back together again: the lexer must never lose or invent a character. */
function rejoin(code: string, name: string): string {
  return highlight(code, name)
    .map((token) => token.text)
    .join("");
}

describe("the language table", () => {
  it("has a unique id and label for each language, and no clashing alias", () => {
    const names = new Set<string>();
    for (const language of LANGUAGES) {
      for (const name of [language.id, ...(language.aliases ?? [])]) {
        expect(names.has(name), `${name} is listed twice`).toBe(false);
        names.add(name);
      }
      expect(language.label).not.toBe("");
    }
  });

  it("finds a language by its id or an alias, whatever the case", () => {
    expect(findLanguage("js")?.id).toBe("javascript");
    expect(findLanguage("PY")?.id).toBe("python");
    expect(findLanguage(" Bash ")?.id).toBe("shell");
    expect(findLanguage("c++")?.id).toBe("cpp");
    expect(findLanguage("brainfuck")).toBeNull();
  });

  it("labels a block by its language, or by whatever the author wrote", () => {
    expect(languageLabel("js")).toBe("JavaScript");
    expect(languageLabel("")).toBe("Plain text");
    // Not a language we have, and still the author's word for it.
    expect(languageLabel("brainfuck")).toBe("brainfuck");
  });
});

describe("what the lexer will not do", () => {
  it("is the identity on the text, whatever the language", () => {
    const samples = [
      "const x = 1; // hi\nlet y = 'a'",
      "def f():\n    return {'a': 1}",
      '{"a": [1, 2], "b": null}',
      "SELECT * FROM t WHERE a = 'b' -- note",
      '<p class="x">hi</p>',
      "\n\n   \t  ",
      "",
    ];
    for (const language of [...LANGUAGES.map((item) => item.id), "", "nonsense"]) {
      for (const sample of samples) {
        expect(rejoin(sample, language)).toBe(sample);
      }
    }
  });

  it("leaves everything plain when it does not know the language", () => {
    const tokens = tokenize("const x = 1 // hi", null);
    expect(tokens).toEqual([{ kind: "plain", text: "const x = 1 // hi" }]);
    expect(highlight("const x = 1", "brainfuck").every((token) => token.kind === "plain")).toBe(
      true,
    );
  });

  it("runs an unterminated string only to the end of its line", () => {
    // Otherwise one stray quote paints the rest of the block as a string.
    expect(of("x = 'oops\ny = 2", "python", "string")).toEqual(["'oops"]);
    expect(of("x = 'oops\ny = 2", "python", "number")).toEqual(["2"]);
  });
});

describe("JavaScript", () => {
  const code = [
    "// a note",
    "const total = 42;",
    "/* over",
    "   two lines */",
    "const name = `hi ${who}`;",
  ].join("\n");

  it("finds comments, keywords, numbers and strings", () => {
    expect(of(code, "js", "comment")).toEqual(["// a note", "/* over\n   two lines */"]);
    expect(of(code, "js", "keyword")).toEqual(["const", "const"]);
    expect(of(code, "js", "number")).toEqual(["42"]);
    expect(of(code, "js", "string")).toEqual(["`hi ${who}`"]);
  });

  it("does not read a keyword or a number out of the middle of a name", () => {
    expect(of("constant = 1", "js", "keyword")).toEqual([]);
    expect(of("utf8 = 1", "js", "number")).toEqual(["1"]);
  });
});

describe("JSON", () => {
  const code = '{\n  "name": "ledge",\n  "count": 3,\n  "ok": true\n}';

  it("tells a key from the string it points at", () => {
    expect(of(code, "json", "property")).toEqual(['"name"', '"count"', '"ok"']);
    expect(of(code, "json", "string")).toEqual(['"ledge"']);
    expect(of(code, "json", "number")).toEqual(["3"]);
    expect(of(code, "json", "keyword")).toEqual(["true"]);
  });
});

describe("Python", () => {
  const code = [
    "# count them",
    "def total(rows):",
    '    """How many."""',
    "    return len(rows) + 1",
  ].join("\n");

  it("finds its own comment marker, keywords and a docstring", () => {
    expect(of(code, "python", "comment")).toEqual(["# count them"]);
    expect(of(code, "python", "keyword")).toEqual(["def", "return"]);
    expect(of(code, "python", "string")).toEqual(['"""How many."""']);
    expect(of(code, "python", "number")).toEqual(["1"]);
  });

  it("keeps a triple-quoted string together across lines", () => {
    expect(of('x = """one\ntwo"""', "py", "string")).toEqual(['"""one\ntwo"""']);
  });
});

describe("Java", () => {
  it("finds its keywords and literals", () => {
    const code = "public static void main(String[] a) { int n = 0x1F; }";
    expect(of(code, "java", "keyword")).toEqual(["public", "static", "void", "int"]);
    expect(of(code, "java", "number")).toEqual(["0x1F"]);
  });
});

describe("SQL", () => {
  it("matches keywords whatever their case, and reads its own comment", () => {
    const code = "select id from t -- all of them\nWHERE n > 10";
    expect(of(code, "sql", "keyword")).toEqual(["select", "from", "WHERE"]);
    expect(of(code, "sql", "comment")).toEqual(["-- all of them"]);
    expect(of(code, "sql", "number")).toEqual(["10"]);
  });
});

describe("HTML", () => {
  const code = '<!-- top -->\n<a href="https://x.test" hidden>go</a>';

  it("colours tags and attributes rather than words", () => {
    expect(of(code, "html", "comment")).toEqual(["<!-- top -->"]);
    expect(of(code, "html", "keyword")).toEqual(["a", "a"]);
    expect(of(code, "html", "property")).toEqual(["href"]);
    expect(of(code, "html", "string")).toEqual(['"https://x.test"']);
  });

  it("does not call the text between tags an attribute", () => {
    expect(of("<p>total 7</p>", "html", "property")).toEqual([]);
    expect(of("<p>total 7</p>", "html", "number")).toEqual([]);
  });
});

describe("CSS", () => {
  it("reads declarations as properties and at-rules as keywords", () => {
    const code = "@media (min-width: 400px) {\n  color: red; /* hm */\n}";
    expect(of(code, "css", "property")).toEqual(["min-width", "color"]);
    expect(of(code, "css", "keyword")).toEqual(["media"]);
    expect(of(code, "css", "comment")).toEqual(["/* hm */"]);
  });
});

describe("YAML", () => {
  it("reads keys and its own comment marker", () => {
    const code = "name: ledge # the app\nversion: 1";
    expect(of(code, "yaml", "property")).toEqual(["name", "version"]);
    expect(of(code, "yml", "comment")).toEqual(["# the app"]);
  });
});
