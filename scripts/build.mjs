// Runs `next build` with NODE_ENV=production on every system. A different NODE_ENV (some tools set "development" or "test")
// makes the Next.js build fail with "<Html> should not be imported outside of pages/_document".
import { spawn } from "node:child_process";
const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "build"], { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } });
child.on("exit", (code) => process.exit(code ?? 1));
