import * as fs from "node:fs";
import * as path from "node:path";

export function findGitRoot(from: string): string | null {
  let dir = path.resolve(from);
  const { root } = path.parse(dir);
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  if (fs.existsSync(path.join(root, ".git"))) return root;
  return null;
}
