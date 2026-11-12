import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATABASE_PACKAGE = resolve(PROJECT_ROOT, "packages/db");
const TEST_TIMEOUT_MS = 30_000;

async function runCopiedDatabaseBuild(packageDirectory: string): Promise<void> {
  await new Promise<void>((resolveBuild, rejectBuild) => {
    const child = spawn("bun", ["run", "build"], {
      cwd: packageDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", rejectBuild);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveBuild();
      else {
        rejectBuild(
          new Error(
            `Copied database build failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.\n${output}`,
          ),
        );
      }
    });
  });
}

describe("database package build contract", () => {
  it(
    "removes stale output without deleting outside its exact dist directory",
    async () => {
      const fixtureRoot = await mkdtemp(resolve(PROJECT_ROOT, ".market-db-build-"));
      const copiedPackage = resolve(fixtureRoot, "db");
      const siblingCanary = resolve(fixtureRoot, "outside-dist.canary");
      const staleOutput = resolve(copiedPackage, "dist/stale-output.txt");

      try {
        await cp(DATABASE_PACKAGE, copiedPackage, { recursive: true });
        await mkdir(resolve(copiedPackage, "dist"), { recursive: true });
        await writeFile(staleOutput, "stale", "utf8");
        await writeFile(siblingCanary, "retained", "utf8");

        await runCopiedDatabaseBuild(copiedPackage);

        await expect(stat(staleOutput)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readFile(siblingCanary, "utf8")).toBe("retained");
        await expect(stat(resolve(copiedPackage, "dist/index.js"))).resolves.toBeTruthy();
        await expect(stat(resolve(copiedPackage, "dist/index.d.ts"))).resolves.toBeTruthy();
        await expect(stat(resolve(copiedPackage, "dist/schema.js"))).resolves.toBeTruthy();
        await expect(stat(resolve(copiedPackage, "dist/schema.d.ts"))).resolves.toBeTruthy();
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
