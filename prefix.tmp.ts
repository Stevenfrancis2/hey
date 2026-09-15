/** Sizes the cacheable prefix so step 2 can be reasoned about with numbers. */
import { allTools } from "./src/agent/tools.js";
import { buildSystem } from "./src/agent/prompt.js";
import { pool } from "./src/db/index.js";

const system = await buildSystem();
const toolsJson = JSON.stringify(allTools);
const stable = system[0]?.text ?? "";
const volatile = system[1]?.text ?? "";

// ~3.6 chars/token is a reasonable English+JSON approximation; the real number
// comes from count_tokens once there is a key.
const est = (s: string) => Math.round(s.length / 3.6);

console.log(`tools:            ${allTools.length} definitions, ${toolsJson.length} chars  ~${est(toolsJson)} tok`);
console.log(`system stable:    ${stable.length} chars  ~${est(stable)} tok   (cache_control here)`);
console.log(`system volatile:  ${volatile.length} chars  ~${est(volatile)} tok  (outside cache)`);
console.log(`CACHED PREFIX:    ~${est(toolsJson) + est(stable)} tok`);
console.log(`minimum for Opus: 1024 tok -> ${est(toolsJson) + est(stable) > 1024 ? "well above, will cache" : "TOO SMALL, silently uncached"}`);
console.log(`\nvolatile block text: ${JSON.stringify(volatile)}`);

// Confirm the tool list is byte-identical across calls — any drift breaks the prefix.
const again = JSON.stringify(allTools);
console.log(`tools stable across reads: ${again === toolsJson}`);

const s2 = await buildSystem();
console.log(`stable system block identical across builds: ${s2[0]?.text === stable}`);
console.log(`volatile block differs (expected, holds clock): ${s2[1]?.text !== volatile || "same second"}`);
await pool.end();
