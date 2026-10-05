"use strict";

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_ASSIGNMENTS = 5000;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const extractFence = (lines, diagnostics) => {
  const nonblank = lines
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => text.trim());
  const [first] = nonblank;
  if (!first?.text.trim().startsWith("```")) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return lines.map((text, index) => ({ text, line: index + 1 }));
  }
  const opening = first.text.trim().match(/^```(?:env|dotenv)?\s*$/iu);
  if (!opening) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    diagnostics.push({
      line: first.line,
      code: "unsupported_fence",
      message: "Only one plain, env, or dotenv code fence is supported.",
    });
    return [];
  }
  const closing = nonblank.at(-1);
  if (
    !closing ||
    closing.line === first.line ||
    closing.text.trim() !== "```"
  ) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    diagnostics.push({
      line: first.line,
      code: "unterminated_fence",
      message: "The code fence is not closed.",
    });
    return [];
  }
  if (nonblank.some(({ line }) => line < first.line || line > closing.line)) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    diagnostics.push({
      line: closing.line,
      code: "unsupported_content",
      message: "Only one enclosing code fence is supported.",
    });
    return [];
  }
  return (
    lines
      .slice(first.line, closing.line - 1)
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      .map((text, index) => ({ text, line: first.line + index + 1 }))
  );
};

const parseAssignment = (lines, startIndex) => {
  const firstLine = lines[startIndex];
  const prefix = /^\s*(?:export\s+)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(
    firstLine.text
  );
  if (!prefix) {
    return { error: "invalid_assignment", lastIndex: startIndex };
  }
  const [, key] = prefix;
  let rest = firstLine.text.slice(prefix[0].length);
  let value = "";
  rest = rest.replace(/^\s+/u, "");
  const quote = rest[0] === "'" || rest[0] === '"' ? rest[0] : null;
  let index = startIndex;
  if (quote !== null) {
    rest = rest.slice(1);
  }
  while (true) {
    let cursor = 0;
    while (cursor < rest.length) {
      const char = rest[cursor];
      if (quote !== null && char === quote) {
        const trailing = rest.slice(cursor + 1);
        if (!/^(?:\s*(?:#.*)?)?$/u.test(trailing)) {
          return { error: "trailing_material", lastIndex: index };
        }
        // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
        return { key, value, lastIndex: index };
      }
      if (quote === '"' && char === "\\") {
        if (cursor + 1 >= rest.length) {
          value += char;
          cursor += 1;
          continue;
        }
        const next = rest[cursor + 1];
        // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
        const escaped = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };
        value += Object.hasOwn(escaped, next) ? escaped[next] : `\\${next}`;
        cursor += 2;
        continue;
      }
      if (
        quote === null &&
        char === "#" &&
        (cursor === 0 || /\s/u.test(rest[cursor - 1]))
      ) {
        // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
        return { key, value: value.trimEnd(), lastIndex: index };
      }
      value += char;
      cursor += 1;
    }
    if (quote === null) {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      return { key, value: value.trim(), lastIndex: index };
    }
    index += 1;
    if (index >= lines.length) {
      return { error: "unterminated_quote", lastIndex: lines.length - 1 };
    }
    value += "\n";
    rest = lines[index].text;
  }
};

const diagnosticMessage = (code) =>
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  ({
    invalid_assignment: "Line must contain a supported KEY=value assignment.",
    invalid_key:
      "Assignment key must use letters, digits, or underscores and start with a letter or underscore.",
    unterminated_quote: "Quoted value is not closed.",
    trailing_material:
      "Only whitespace or a comment may follow a quoted value.",
  })[code] || "Input could not be parsed.";

const parseEnvironmentText = (source) => {
  const diagnostics = [];
  if (typeof source !== "string") {
    return {
      assignments: [],
      diagnostics: [
        // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
        { line: 1, code: "invalid_input", message: "Input must be text." },
      ],
    };
  }
  if (Buffer.byteLength(source, "utf-8") > MAX_INPUT_BYTES) {
    return {
      assignments: [],
      diagnostics: [
        // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
        {
          line: 1,
          code: "input_too_large",
          message: "Input exceeds the 1 MiB limit.",
        },
      ],
    };
  }
  if (source.includes("\0")) {
    const line = source
      .slice(0, source.indexOf("\0"))
      .split(/\r\n|\r|\n/u).length;
    return {
      assignments: [],
      diagnostics: [
        // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
        {
          line,
          code: "nul_character",
          message: "NUL characters are not supported.",
        },
      ],
    };
  }

  const originalLines = source.replace(/^\uFEFF/u, "").split(/\r\n|\n|\r/u);
  const lines = extractFence(originalLines, diagnostics);
  const assignments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].text;
    const lineNumber = lines[index].line;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const parsed = parseAssignment(lines, index);
    if (parsed.error) {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      diagnostics.push({
        line: lineNumber,
        code: parsed.error,
        message: diagnosticMessage(parsed.error),
      });
      continue;
    }
    index = parsed.lastIndex;
    if (!KEY_PATTERN.test(parsed.key)) {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      diagnostics.push({
        line: lineNumber,
        code: "invalid_key",
        message:
          "Assignment key must use letters, digits, or underscores and start with a letter or underscore.",
      });
      continue;
    }
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    assignments.push({
      key: parsed.key,
      value: parsed.value,
      line: lineNumber,
    });
    if (assignments.length > MAX_ASSIGNMENTS) {
      return {
        assignments: [],
        diagnostics: [
          // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
          {
            line: lineNumber,
            code: "too_many_assignments",
            message: "Input exceeds the 5,000 assignment limit.",
          },
        ],
      };
    }
  }
  if (assignments.length === 0 && diagnostics.length === 0) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    diagnostics.push({
      line: 1,
      code: "empty_input",
      message: "No environment assignments were found.",
    });
  }
  return { assignments, diagnostics };
};

// eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
module.exports = { parseEnvironmentText, MAX_INPUT_BYTES, MAX_ASSIGNMENTS };
