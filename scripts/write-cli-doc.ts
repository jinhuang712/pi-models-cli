import { writeFileSync } from "node:fs";
import { renderCliDoc } from "./cli-doc.ts";

writeFileSync(new URL("../CLI.md", import.meta.url), renderCliDoc());
console.log("wrote CLI.md");
