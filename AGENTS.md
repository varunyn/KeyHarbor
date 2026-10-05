# KeyHarbor-App - AI Agent Guidelines

## Language

- Keep repository documentation, source comments, logs, diagnostics, and agent instructions in English.
- Do not add translated Markdown files or non-English repository content unless the user explicitly requests it.

## CSS structure

### common.css (src/styles/common.css)

Contains only shared styles used across pages or reusable general-purpose styles.

**Decision rule:** Even if a pattern is currently used on only one page, place it in `common.css` when it could naturally be reused elsewhere.

### Page-specific CSS (src/styles/<page>.css)

Contains component styles that belong only to a particular page or feature.

**Include in page-specific files:**

- Feature-specific UI components (for example, `vault-selector`, `vault-dropdown`, and `vault-item` belong to the dashboard)
- Page layout structure, such as sidebars and content areas
- Styles unlikely to be reused on another page

---

### CSS load order in HTML

```html
<link rel="stylesheet" href="../styles/common.css" />
<link rel="stylesheet" href="../styles/<page>.css" />
<!-- Only when the page has its own stylesheet -->
```

Always load `common.css` first so page-specific CSS can override it.

## TypeScript and formatting

Backend, CLI/MCP, and test source files are TypeScript compiled for Node.js 20.19 support. Keep one source implementation; do not add duplicate handwritten JavaScript or rely on Node's native TypeScript stripping.

Use `npm run check` for the read-only Ultracite check. Format only named files with `npm run fix -- <path>`; this command runs Oxfmt formatting only. Do not use broad unused-code autofix on converted CommonJS modules, where exports may be consumed through `module.exports`.
