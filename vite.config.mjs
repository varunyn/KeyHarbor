import { readdirSync } from "node:fs";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const sourceRoot = import.meta.dirname;
const viewsRoot = path.join(sourceRoot, "src", "views");
const outputRoot = path.join(sourceRoot, "src", "renderer-build");
const commonStylesFirst = () => ({
  generateBundle: {
    handler(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (
          output.type !== "asset" ||
          !output.fileName.endsWith(".html") ||
          typeof output.source !== "string"
        ) {
          continue;
        }
        const links = [
          ...output.source.matchAll(
            /^[\t ]*<link[^>]*rel="stylesheet"[^>]*>[\t ]*$/gmu
          ),
        ].map(([link]) => link);
        const commonLinks = links.filter((link) => link.includes("common-"));
        if (commonLinks.length === 0) {
          continue;
        }
        const orderedLinks = [
          ...commonLinks,
          ...links.filter((link) => !commonLinks.includes(link)),
        ];
        let index = 0;
        output.source = output.source.replaceAll(
          /^[\t ]*<link[^>]*rel="stylesheet"[^>]*>[\t ]*$/gmu,
          () => {
            const link = orderedLinks[index];
            index += 1;
            return link;
          }
        );
      }
    },
    order: "post",
  },
  name: "common-styles-first",
});
const htmlEntries = Object.fromEntries(
  readdirSync(viewsRoot)
    .filter((file) => file.endsWith(".html"))
    .map((file) => [`views/${file.slice(0, -5)}`, path.join(viewsRoot, file)])
);

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: outputRoot,
    rollupOptions: { input: htmlEntries },
  },
  plugins: [tailwindcss(), commonStylesFirst()],
  publicDir: false,
  resolve: { alias: { "@": path.join(sourceRoot, "src") } },
  root: path.join(sourceRoot, "src"),
});
