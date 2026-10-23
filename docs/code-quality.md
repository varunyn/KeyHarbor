# Code quality

KeyHarbor uses Ultracite's Oxlint core and React presets, Oxfmt, and the bundled `ultracite/oxlint/anti-slop` preset. No additional plugin dependency or copied plugin source is needed.

The anti-slop adoption is inspired by [Pond's plugin configuration](https://github.com/raphaelsalaja/pond/tree/main/tools/oxlint/anti-slop). Pond's plugin targets type escape hatches and low-signal code patterns; it does not limit file length. KeyHarbor enforces file length separately.

## Required checks

- `npm run check`: read-only formatting and lint checks, including file ceilings and the enabled anti-slop rules. CI already runs this command.
- `npm run check:backend`: backend lint checks and TypeScript validation.
- `npm test`: the existing behavioral test suite.

## File length and ownership

JavaScript and TypeScript files, including TSX components and tests, have a 500-line maximum. Blank lines and comments count. Existing oversized files have explicit temporary ceilings in `oxlint.config.mts`, fixed at their size when the limit was introduced. They remain refactoring work; the limit does not split them automatically.

Do not raise a ceiling or add another exception for new code. Extract cohesive responsibilities before extending a file at its ceiling. Lower the ceiling as an existing file shrinks, and remove its entry once it fits within 500 lines. Avoid numbered chunks, compressed formatting, and generic dumping-ground utilities. Prefer descriptive modules with deliberate public interfaces. Entrypoints should compose features rather than own their implementations.

This lint rule covers JavaScript and TypeScript. CSS, HTML, JSON, and native code are outside its scope.

## Staged anti-slop adoption

The normal checks enforce these eight rules as errors across the repository:

- `no-known-value-widening`
- `no-reflect-apply`
- `no-chained-type-assertions`
- `no-shape-in-symbol-names`
- `no-module-mocking`
- `no-reflect-get`
- `no-unknown-type-aliases`
- `no-widen-then-assert`

The other seven rules have existing violations and are explicitly deferred in `oxlint.config.mts`. They cover conditional empty-object spreads, broad `object` parameters, runtime `typeof`, `unknown` parameters and returns, dictionary types, and safety comments for assertions.

Run `npm run check:anti-slop` to audit all fifteen rules. This command is read-only, returns a nonzero exit code while violations remain, and is intentionally separate from required CI. `oxlint.audit.config.mts` restores every rule from the bundled preset while retaining the normal file ceilings and CommonJS overrides.

For machine-readable migration output:

```sh
npm run check:anti-slop -- --format json
```

Migrate one rule at a time with behavioral validation, then remove its `off` setting from the normal configuration. Do not add suppressions, substitute `any` for `unknown`, or remove runtime input checks to make the audit green. Validate external data at its boundary and preserve fail-closed behavior. Review the `no-runtime-typeof` rule carefully: security-sensitive boundary checks remain necessary, and the bundled preset permits `typeof` inside type predicates.
