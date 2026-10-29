import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import * as ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const STORAGE_ENV_KEYS = [
  "STORAGE_SERVICE",
  "BLOB_READ_WRITE_TOKEN",
  "AZURE_STORAGE_CONTAINER_NAME",
  "AZURE_ACCOUNT_NAME",
  "AZURE_ACCOUNT_KEY",
  "AZURE_CONNECTION_STRING",
] as const;
const originalStorageEnvironment = new Map(
  STORAGE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function restoreStorageEnvironment(): void {
  for (const key of STORAGE_ENV_KEYS) {
    const original = originalStorageEnvironment.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

async function loadStorageSetup(
  environment: Partial<Record<(typeof STORAGE_ENV_KEYS)[number], string>>,
) {
  for (const key of STORAGE_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) process.env[key] = value;
  }
  vi.resetModules();
  return import("../../uploads/core/setup");
}

function parseTypeScript(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function importedModules(sourceFile: ts.SourceFile): string[] {
  const modules: string[] = [];
  sourceFile.forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text);
    }
  });
  return modules;
}

function callsIdentifier(sourceFile: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

async function clientFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  };
  await walk(root);
  return files;
}

afterEach(() => {
  restoreStorageEnvironment();
  vi.restoreAllMocks();
  vi.doUnmock("../../uploads/core/setup.server");
  vi.resetModules();
});

describe("original Market storage provider selection", () => {
  const bothCloudConfigurations = {
    BLOB_READ_WRITE_TOKEN: "vercel-token",
    AZURE_STORAGE_CONTAINER_NAME: "market-files",
    AZURE_CONNECTION_STRING: "azure-connection",
  } as const;

  it.each([
    ["LOCAL", "local"],
    ["VERCEL", "vercel"],
    ["AZURE", "azure"],
  ] as const)("honors explicit %s selection", async (service, expected) => {
    const setup = await loadStorageSetup({
      ...bothCloudConfigurations,
      STORAGE_SERVICE: service,
    });
    expect(setup.STORAGE_SERVICE).toBe(expected);
    expect(setup.getStorageProvider()).toBe(expected);
  });

  it.each([
    ["no cloud configuration", {}, "local"],
    ["Vercel-only configuration", { BLOB_READ_WRITE_TOKEN: "token" }, "vercel"],
    [
      "Azure connection-string configuration",
      {
        AZURE_STORAGE_CONTAINER_NAME: "market-files",
        AZURE_CONNECTION_STRING: "azure-connection",
      },
      "azure",
    ],
    [
      "Azure account-key configuration",
      {
        AZURE_STORAGE_CONTAINER_NAME: "market-files",
        AZURE_ACCOUNT_NAME: "market",
        AZURE_ACCOUNT_KEY: "account-key",
      },
      "azure",
    ],
    [
      "partial Azure configuration",
      { AZURE_STORAGE_CONTAINER_NAME: "market-files" },
      "local",
    ],
  ] as const)("auto-detects %s as %s", async (_name, environment, expected) => {
    const setup = await loadStorageSetup(environment);
    expect(setup.STORAGE_SERVICE).toBe(expected);
  });

  it("uses local and warns when both cloud configurations are present", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const setup = await loadStorageSetup(bothCloudConfigurations);
    expect(setup.STORAGE_SERVICE).toBe("local");
    expect(warning).toHaveBeenCalledWith(
      "Multiple storage credentials detected (Vercel + Azure). Set STORAGE_SERVICE to choose a provider.",
    );
  });

  it("documents the optional selector without pinning copied environments", async () => {
    const [example, readme] = await Promise.all([
      readFile(join(PROJECT_ROOT, ".env.example"), "utf8"),
      readFile(join(PROJECT_ROOT, "README.md"), "utf8"),
    ]);
    expect(example).not.toMatch(/^STORAGE_SERVICE=/mu);
    expect(example).toContain("# STORAGE_SERVICE=LOCAL");
    expect(example).toContain("selects VERCEL for only complete Vercel credentials");
    expect(example).toContain("AZURE for only complete Azure credentials");
    expect(example).toContain("LOCAL when neither or both");
    expect(example).toContain("Detecting both selects LOCAL and emits a");
    expect(readme).toContain("Only complete Vercel credentials select `VERCEL`");
    expect(readme).toContain("Only complete Azure credentials select `AZURE`");
    expect(readme).toContain("Neither complete credential set selects `LOCAL`");
    expect(readme).toContain("Both complete credential sets select `LOCAL` and emit a warning");
  });
});

describe("original Market storage consumers", () => {
  const consumers = [
    "app/api/uploads/chain-icon/route.ts",
    "app/api/uploads/country-icon/route.ts",
    "app/api/uploads/crypto-icon/route.ts",
    "app/api/uploads/currency-icon/route.ts",
    "app/api/uploads/listing-icon/route.ts",
    "app/api/account/profile/image/route.ts",
  ] as const;

  it.each(consumers)("keeps %s on the shared abstraction", async (consumer) => {
    const path = join(PROJECT_ROOT, consumer);
    const sourceFile = parseTypeScript(path, await readFile(path, "utf8"));
    const modules = importedModules(sourceFile);
    expect(modules).toContain("@uploads/core/storage-client");
    expect(callsIdentifier(sourceFile, "uploadFileWithKey")).toBe(true);
    expect(
      modules.some(
        (module) =>
          module.includes("uploads/providers/") ||
          module === "@azure/storage-blob" ||
          module === "@vercel/blob",
      ),
    ).toBe(false);
  });

  it("keeps exactly the local, Vercel, and Azure provider surface", async () => {
    const setupPath = join(PROJECT_ROOT, "uploads/core/setup.ts");
    const setup = parseTypeScript(setupPath, await readFile(setupPath, "utf8"));
    const alias = setup.statements.find(
      (statement): statement is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(statement) && statement.name.text === "StorageService",
    );
    expect(alias).toBeDefined();
    expect(alias && ts.isUnionTypeNode(alias.type)).toBe(true);
    const services = alias && ts.isUnionTypeNode(alias.type)
      ? alias.type.types.map((type) =>
          ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)
            ? type.literal.text
            : "",
        )
      : [];
    expect(services).toEqual(["local", "vercel", "azure"]);

    const providersRoot = join(PROJECT_ROOT, "uploads/providers");
    const files = (await clientFiles(providersRoot))
      .map((path) => relative(providersRoot, path).replaceAll("\\", "/"))
      .sort();
    expect(files).toEqual(["blob/blob-client.ts", "vercel/blob-client.ts"]);

    const clientPath = join(PROJECT_ROOT, "uploads/core/storage-client.ts");
    const client = parseTypeScript(clientPath, await readFile(clientPath, "utf8"));
    const providerImports: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text.startsWith("../providers/")
      ) {
        providerImports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(client);
    expect([...new Set(providerImports)].sort()).toEqual([
      "../providers/blob/blob-client",
      "../providers/vercel/blob-client",
    ]);
  });

  it("uploads and serves a real local file through the Market route", async () => {
    const directory = await mkdtemp(join(tmpdir(), "market-storage-"));
    try {
      for (const key of STORAGE_ENV_KEYS) delete process.env[key];
      process.env.STORAGE_SERVICE = "LOCAL";
      vi.resetModules();
      vi.doMock("../../uploads/core/setup.server", () => ({
        UPLOAD_DIR_SERVER: directory,
        ensureUploadsDirectory: async () => {
          await mkdir(directory, { recursive: true });
          return true;
        },
      }));

      const { uploadFileWithKey } = await import("../../uploads/core/storage-client");
      const { GET } = await import("../../app/api/files/serve/[...key]/route");
      const bytes = Buffer.from("market-storage-regression", "utf8");
      const uploaded = await uploadFileWithKey(
        bytes,
        "storage-tests/preserved.txt",
        "text/plain",
        bytes.length,
      );
      expect(uploaded.path).toBe(
        "/api/files/serve/storage-tests/preserved.txt",
      );

      const response = await GET(
        new Request(`https://market.example.com${uploaded.path}`),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/plain");
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
