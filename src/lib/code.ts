/**
 * Syntax highlighting for fenced code blocks, as a small lexer driven by a table
 * of languages.
 *
 * Why not a library. highlight.js and its neighbours are built to be right about
 * every construct in a hundred grammars, and cost a hundred kilobytes and a
 * dependency outside section 4 of the brief to do it. What a 320 px panel shows
 * is a snippet of ten lines, where the whole of the value is telling comments,
 * strings, numbers and keywords apart. That is a lexer, not a parser, and it
 * fits in one file with no dependency at all.
 *
 * So: this is deliberately lexical. It knows nothing about scope, types or
 * grammar, it will call a keyword used as a variable name a keyword, and it will
 * not colour a function name. It never throws and never fails to produce output:
 * anything it does not recognise stays plain, which is exactly how it degrades
 * on a language it does not have.
 *
 * Pure, like the rest of `lib/`.
 */

export type TokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "property";

export interface Token {
  kind: TokenKind;
  text: string;
}

export interface Language {
  /** Stored after the opening fence, and what the picker writes. */
  id: string;
  /** Shown in the picker and on the block. */
  label: string;
  /** Other names accepted after a fence: `js`, `py`, `sh`. */
  aliases?: readonly string[];
  keywords?: readonly string[];
  /** Keywords match whatever their case (SQL). */
  ignoreCase?: boolean;
  lineComment?: readonly string[];
  blockComment?: readonly [string, string];
  /** Quote characters that open a string. */
  quotes?: readonly string[];
  /** `"""` and `'''` as well, for Python. */
  tripleQuotes?: boolean;
  /** A backslash escapes the next character inside a string. */
  escape?: boolean;
  /** A name followed by `:` is a property: JSON keys, CSS properties, YAML. */
  property?: boolean;
  /** Tags and attributes rather than keywords: HTML and XML. */
  markup?: boolean;
  /** Off for the markup languages, where a bare number is rarely a literal. */
  numbers?: boolean;
}

const C_LIKE = {
  lineComment: ["//"],
  blockComment: ["/*", "*/"] as const,
  quotes: ['"', "'"],
  escape: true,
};

/**
 * The languages offered, in the order the picker shows them: the ones a note is
 * most likely to hold first, then the rest alphabetically enough to scan.
 */
export const LANGUAGES: readonly Language[] = [
  {
    id: "json",
    label: "JSON",
    keywords: ["true", "false", "null"],
    quotes: ['"'],
    escape: true,
    property: true,
  },
  {
    id: "javascript",
    label: "JavaScript",
    aliases: ["js", "jsx", "mjs", "cjs", "node"],
    ...C_LIKE,
    quotes: ['"', "'", "`"],
    keywords: [
      "async", "await", "break", "case", "catch", "class", "const", "continue",
      "debugger", "default", "delete", "do", "else", "export", "extends",
      "finally", "for", "from", "function", "get", "if", "import", "in",
      "instanceof", "let", "new", "of", "return", "set", "static", "super",
      "switch", "this", "throw", "try", "typeof", "var", "void", "while",
      "with", "yield", "true", "false", "null", "undefined", "NaN",
    ],
  },
  {
    id: "typescript",
    label: "TypeScript",
    aliases: ["ts", "tsx"],
    ...C_LIKE,
    quotes: ['"', "'", "`"],
    keywords: [
      "abstract", "any", "as", "asserts", "async", "await", "boolean", "break",
      "case", "catch", "class", "const", "continue", "declare", "default",
      "delete", "do", "else", "enum", "export", "extends", "finally", "for",
      "from", "function", "get", "if", "implements", "import", "in", "infer",
      "instanceof", "interface", "is", "keyof", "let", "namespace", "never",
      "new", "number", "of", "private", "protected", "public", "readonly",
      "return", "satisfies", "set", "static", "string", "super", "switch",
      "symbol", "this", "throw", "try", "type", "typeof", "unknown", "var",
      "void", "while", "yield", "true", "false", "null", "undefined",
    ],
  },
  {
    id: "python",
    label: "Python",
    aliases: ["py"],
    lineComment: ["#"],
    quotes: ['"', "'"],
    tripleQuotes: true,
    escape: true,
    keywords: [
      "and", "as", "assert", "async", "await", "break", "class", "continue",
      "def", "del", "elif", "else", "except", "finally", "for", "from",
      "global", "if", "import", "in", "is", "lambda", "match", "nonlocal",
      "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
      "True", "False", "None", "self", "cls",
    ],
  },
  {
    id: "java",
    label: "Java",
    ...C_LIKE,
    keywords: [
      "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
      "class", "const", "continue", "default", "do", "double", "else", "enum",
      "extends", "final", "finally", "float", "for", "goto", "if", "implements",
      "import", "instanceof", "int", "interface", "long", "native", "new",
      "package", "private", "protected", "public", "record", "return", "sealed",
      "short", "static", "strictfp", "super", "switch", "synchronized", "this",
      "throw", "throws", "transient", "try", "var", "void", "volatile", "while",
      "yield", "true", "false", "null",
    ],
  },
  {
    id: "kotlin",
    label: "Kotlin",
    aliases: ["kt"],
    ...C_LIKE,
    keywords: [
      "as", "break", "by", "catch", "class", "companion", "const", "constructor",
      "continue", "data", "do", "else", "enum", "external", "false", "final",
      "finally", "for", "fun", "get", "if", "import", "in", "infix", "init",
      "inline", "interface", "internal", "is", "lateinit", "null", "object",
      "open", "operator", "override", "package", "private", "protected",
      "public", "return", "sealed", "set", "super", "suspend", "this", "throw",
      "true", "try", "typealias", "val", "var", "when", "while",
    ],
  },
  {
    id: "c",
    label: "C",
    ...C_LIKE,
    keywords: [
      "auto", "break", "case", "char", "const", "continue", "default", "do",
      "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline",
      "int", "long", "register", "return", "short", "signed", "sizeof", "static",
      "struct", "switch", "typedef", "union", "unsigned", "void", "volatile",
      "while", "NULL",
    ],
  },
  {
    id: "cpp",
    label: "C++",
    aliases: ["c++", "cc", "hpp"],
    ...C_LIKE,
    keywords: [
      "auto", "bool", "break", "case", "catch", "char", "class", "const",
      "constexpr", "continue", "default", "delete", "do", "double", "else",
      "enum", "explicit", "export", "extern", "false", "float", "for", "friend",
      "goto", "if", "inline", "int", "long", "namespace", "new", "noexcept",
      "nullptr", "operator", "private", "protected", "public", "return",
      "short", "signed", "sizeof", "static", "struct", "switch", "template",
      "this", "throw", "true", "try", "typedef", "typename", "union",
      "unsigned", "using", "virtual", "void", "volatile", "while",
    ],
  },
  {
    id: "csharp",
    label: "C#",
    aliases: ["cs", "c#"],
    ...C_LIKE,
    keywords: [
      "abstract", "as", "async", "await", "base", "bool", "break", "byte",
      "case", "catch", "char", "checked", "class", "const", "continue",
      "decimal", "default", "delegate", "do", "double", "else", "enum", "event",
      "explicit", "extern", "false", "finally", "fixed", "float", "for",
      "foreach", "get", "goto", "if", "implicit", "in", "int", "interface",
      "internal", "is", "lock", "long", "namespace", "new", "null", "object",
      "operator", "out", "override", "params", "private", "protected", "public",
      "readonly", "record", "ref", "return", "sbyte", "sealed", "set", "short",
      "sizeof", "stackalloc", "static", "string", "struct", "switch", "this",
      "throw", "true", "try", "typeof", "uint", "ulong", "unchecked", "unsafe",
      "ushort", "using", "var", "virtual", "void", "volatile", "while",
    ],
  },
  {
    id: "go",
    label: "Go",
    aliases: ["golang"],
    ...C_LIKE,
    quotes: ['"', "'", "`"],
    keywords: [
      "break", "case", "chan", "const", "continue", "default", "defer", "else",
      "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
      "map", "package", "range", "return", "select", "struct", "switch", "type",
      "var", "nil", "true", "false", "error", "string", "int", "int64", "bool",
      "byte", "rune", "float64",
    ],
  },
  {
    id: "rust",
    label: "Rust",
    aliases: ["rs"],
    ...C_LIKE,
    keywords: [
      "as", "async", "await", "break", "const", "continue", "crate", "dyn",
      "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let",
      "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self",
      "Self", "static", "struct", "super", "trait", "true", "type", "unsafe",
      "use", "where", "while", "Some", "None", "Ok", "Err",
    ],
  },
  {
    id: "swift",
    label: "Swift",
    ...C_LIKE,
    keywords: [
      "any", "as", "associatedtype", "break", "case", "catch", "class",
      "continue", "default", "defer", "deinit", "do", "else", "enum",
      "extension", "fallthrough", "false", "for", "func", "guard", "if", "import",
      "in", "init", "inout", "internal", "is", "let", "nil", "open", "operator",
      "private", "protocol", "public", "repeat", "return", "self", "Self",
      "static", "struct", "subscript", "super", "switch", "throw", "throws",
      "true", "try", "typealias", "var", "where", "while",
    ],
  },
  {
    id: "sql",
    label: "SQL",
    ignoreCase: true,
    lineComment: ["--"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: [
      "add", "all", "alter", "and", "as", "asc", "begin", "between", "by",
      "case", "cast", "check", "column", "commit", "constraint", "create",
      "cross", "default", "delete", "desc", "distinct", "drop", "else", "end",
      "exists", "foreign", "from", "full", "group", "having", "if", "in",
      "index", "inner", "insert", "into", "is", "join", "key", "left", "like",
      "limit", "not", "null", "offset", "on", "or", "order", "outer", "primary",
      "references", "right", "rollback", "select", "set", "table", "then",
      "transaction", "union", "unique", "update", "using", "values", "view",
      "when", "where", "with",
    ],
  },
  {
    id: "shell",
    label: "Shell",
    aliases: ["sh", "bash", "zsh", "console"],
    lineComment: ["#"],
    quotes: ['"', "'"],
    escape: true,
    keywords: [
      "alias", "case", "cd", "declare", "do", "done", "echo", "elif", "else",
      "esac", "exit", "export", "fi", "for", "function", "if", "in", "local",
      "read", "return", "set", "shift", "source", "then", "unset", "until",
      "while",
    ],
  },
  {
    id: "yaml",
    label: "YAML",
    aliases: ["yml"],
    lineComment: ["#"],
    quotes: ['"', "'"],
    property: true,
    keywords: ["true", "false", "null", "yes", "no", "on", "off"],
  },
  {
    id: "html",
    label: "HTML",
    aliases: ["xml", "svg", "xhtml"],
    blockComment: ["<!--", "-->"],
    quotes: ['"', "'"],
    markup: true,
    numbers: false,
  },
  {
    id: "css",
    label: "CSS",
    aliases: ["scss", "less"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    property: true,
    keywords: [
      "charset", "container", "import", "keyframes", "layer", "media",
      "supports", "important", "inherit", "initial", "unset", "var",
    ],
  },
];

const BY_NAME = new Map<string, Language>();
for (const language of LANGUAGES) {
  BY_NAME.set(language.id, language);
  for (const alias of language.aliases ?? []) {
    BY_NAME.set(alias, language);
  }
}

/** The language a fence names, or null for none and for one we do not have. */
export function findLanguage(name: string): Language | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/**
 * What to call a block. A name we do not have is still the author's word for it
 * and is shown as written, rather than being silently dropped.
 */
export function languageLabel(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "Plain text";
  }
  return findLanguage(trimmed)?.label ?? trimmed;
}

const IDENT_AT = /[A-Za-z_$][\w$-]*/y;
// Hex, binary and octal literals, then decimals with an optional exponent and
// an optional type suffix (`10L`, `1.5f`, `3u8`).
const NUMBER_AT = /(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[A-Za-z_]*/y;

function matchAt(re: RegExp, text: string, at: number): string | null {
  re.lastIndex = at;
  return re.exec(text)?.[0] ?? null;
}

/** Where a string that opened with `quote` at `from` ends, past its closer. */
function endOfString(
  code: string,
  from: number,
  quote: string,
  escape: boolean,
): number {
  let i = from + quote.length;
  while (i < code.length) {
    if (escape && code[i] === "\\") {
      i += 2;
      continue;
    }
    if (code.startsWith(quote, i)) {
      return i + quote.length;
    }
    // A single-quoted string does not run past its line; a triple-quoted one
    // does. Without this an unbalanced quote would paint the rest of the block.
    if (quote.length === 1 && code[i] === "\n") {
      return i;
    }
    i += 1;
  }
  return code.length;
}

/** The next non-space character at or after `at`, for "is this a property?". */
function nextMeaningful(code: string, at: number): string {
  let i = at;
  while (i < code.length && (code[i] === " " || code[i] === "\t")) {
    i += 1;
  }
  return code[i] ?? "";
}

/**
 * Split `code` into tokens for `language`. With no language every character is
 * plain, which is what a fence with no name renders as.
 *
 * Adjacent plain characters are merged into one token, so a block of prose-like
 * code does not become one span per character.
 */
export function tokenize(code: string, language: Language | null): Token[] {
  if (language === null || code === "") {
    return code === "" ? [] : [{ kind: "plain", text: code }];
  }

  const keywords = new Set(
    (language.keywords ?? []).map((word) =>
      language.ignoreCase === true ? word.toLowerCase() : word,
    ),
  );
  const quotes = [
    ...(language.tripleQuotes === true ? ['"""', "'''"] : []),
    ...(language.quotes ?? []),
  ];
  const wantsNumbers = language.numbers !== false;

  const tokens: Token[] = [];
  let plain = "";
  const push = (kind: TokenKind, text: string) => {
    if (text === "") {
      return;
    }
    if (kind === "plain") {
      plain += text;
      return;
    }
    if (plain !== "") {
      tokens.push({ kind: "plain", text: plain });
      plain = "";
    }
    tokens.push({ kind, text });
  };

  // Markup needs one bit of state: attributes are only attributes inside a tag.
  let inTag = false;
  let i = 0;

  while (i < code.length) {
    const rest = code.slice(i);

    // Comments first: everything else inside one is part of the comment.
    if (language.blockComment !== undefined) {
      const [open, close] = language.blockComment;
      if (rest.startsWith(open)) {
        const at = code.indexOf(close, i + open.length);
        const end = at === -1 ? code.length : at + close.length;
        push("comment", code.slice(i, end));
        i = end;
        continue;
      }
    }
    const line = (language.lineComment ?? []).find((marker) => rest.startsWith(marker));
    if (line !== undefined) {
      const at = code.indexOf("\n", i);
      const end = at === -1 ? code.length : at;
      push("comment", code.slice(i, end));
      i = end;
      continue;
    }

    const quote = quotes.find((mark) => rest.startsWith(mark));
    if (quote !== undefined) {
      const end = endOfString(code, i, quote, language.escape === true);
      push("string", code.slice(i, end));
      i = end;
      continue;
    }

    if (language.markup === true) {
      if (code[i] === "<") {
        const after = code[i + 1] === "/" ? i + 2 : i + 1;
        const name = matchAt(IDENT_AT, code, after);
        if (name !== null) {
          push("plain", code.slice(i, after));
          push("keyword", name);
          i = after + name.length;
          inTag = true;
          continue;
        }
      }
      if (code[i] === ">") {
        inTag = false;
        push("plain", ">");
        i += 1;
        continue;
      }
      if (inTag) {
        const attribute = matchAt(IDENT_AT, code, i);
        if (attribute !== null) {
          push(nextMeaningful(code, i + attribute.length) === "=" ? "property" : "plain", attribute);
          i += attribute.length;
          continue;
        }
      }
    }

    if (wantsNumbers && /\d/.test(code[i] ?? "")) {
      const number = matchAt(NUMBER_AT, code, i);
      // Not in the middle of a name: `utf8` is one identifier, not a number.
      if (number !== null && !/[\w$]/.test(code[i - 1] ?? "")) {
        push("number", number);
        i += number.length;
        continue;
      }
    }

    const word = matchAt(IDENT_AT, code, i);
    if (word !== null) {
      const lookup = language.ignoreCase === true ? word.toLowerCase() : word;
      if (keywords.has(lookup)) {
        push("keyword", word);
      } else if (
        language.property === true &&
        nextMeaningful(code, i + word.length) === ":"
      ) {
        push("property", word);
      } else {
        push("plain", word);
      }
      i += word.length;
      continue;
    }

    push("plain", code[i] ?? "");
    i += 1;
  }

  if (plain !== "") {
    tokens.push({ kind: "plain", text: plain });
  }
  return tokens;
}

/**
 * A quoted key is the JSON case, and the common YAML one: the string has already
 * been emitted, so the property colour is applied by looking at what follows.
 * Done as a pass rather than inside the loop, where it would need a lookahead
 * past a string of any length.
 */
export function markQuotedProperties(tokens: Token[]): Token[] {
  return tokens.map((token, index) => {
    if (token.kind !== "string") {
      return token;
    }
    const next = tokens[index + 1];
    return next !== undefined &&
      next.kind === "plain" &&
      /^[ \t]*:/.test(next.text)
      ? { kind: "property", text: token.text }
      : token;
  });
}

/** Tokens for a block, ready to render. */
export function highlight(code: string, name: string): Token[] {
  const language = findLanguage(name);
  const tokens = tokenize(code, language);
  return language?.property === true ? markQuotedProperties(tokens) : tokens;
}
