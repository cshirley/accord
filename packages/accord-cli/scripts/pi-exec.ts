#!/usr/bin/env bun
import { main } from "../src/harnesses/pi-exec.js";

const code = await main(process.argv.slice(2));
process.exit(code);
