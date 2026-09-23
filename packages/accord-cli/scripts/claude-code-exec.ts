#!/usr/bin/env bun
import { main } from "../src/harnesses/claude-code-exec.js";

const code = await main(process.argv.slice(2));
process.exit(code);
