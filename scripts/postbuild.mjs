// TypeScript strips shebangs from emitted JS. For an npx-installable
// CLI to work, dist/index.js must start with `#!/usr/bin/env node` and
// be marked executable. This script does both after every `tsc` run.

import { readFileSync, writeFileSync, chmodSync } from "node:fs";

const file = "./dist/index.js";
const SHEBANG = "#!/usr/bin/env node";

const content = readFileSync(file, "utf8");
if (!content.startsWith("#!")) {
  writeFileSync(file, `${SHEBANG}\n${content}`);
}
chmodSync(file, 0o755);

console.log(`postbuild: shebang + chmod +x applied to ${file}`);
