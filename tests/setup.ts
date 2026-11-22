import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// One throw-away data folder per test file, so tests never touch real data.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gw-test-"));
process.env.BOOTSTRAP_ADMIN_EMAIL = "admin@example.org";
process.env.BOOTSTRAP_ADMIN_NAME = "Test Admin";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "first-password-123";
process.env.TRUST_PROXY = "1";
