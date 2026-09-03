#!/usr/bin/env bun
import { main } from "../src/harnesses/cursor-agent-exec.js";

const code = await main(process.argv.slice(2));
process.exit(code);
