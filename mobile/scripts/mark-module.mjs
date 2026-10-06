// The test build is plain ES modules. Metro (the app's bundler) wants imports
// without a file extension and node wants them with one, so the extension is
// added here, to the built files only; and a package.json says "module", so
// node does not read the build as CommonJS.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../.test-build/", import.meta.url);
for (const name of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const file = new URL(name, dir);
  const text = readFileSync(file, "utf8").replace(/(from\s+["'])(\.\/[\w-]+)(["'])/g, "$1$2.js$3");
  writeFileSync(file, text);
}
writeFileSync(new URL("package.json", dir), JSON.stringify({ type: "module" }));
