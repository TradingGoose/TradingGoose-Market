import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MARKET_PLUGIN_MODULES_ENV = "MARKET_PLUGIN_MODULES";
const MARKET_PLUGIN_SOURCES_ENV = "MARKET_PLUGIN_SOURCES";
const GENERATED_PLUGIN_FILE_PATH = path.join(
  process.cwd(),
  "lib/market-api/plugins/generated.ts"
);
const GENERATED_PLUGIN_VENDOR_ROOT = path.join(
  process.cwd(),
  "lib/market-api/plugins/vendor"
);
const SHOULD_INSTALL = process.argv.includes("--install");
const INITIAL_ENV_KEYS = new Set(Object.keys(process.env));

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const withoutExport = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trim()
    : trimmed;
  const separatorIndex = withoutExport.indexOf("=");
  if (separatorIndex <= 0) return null;

  const key = withoutExport.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = withoutExport.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const quote = value[0];
    value = value.slice(1, -1);
    if (quote === "\"") {
      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\");
    }
  } else {
    const commentIndex = value.indexOf(" #");
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex).trimEnd();
    }
  }

  return { key, value };
}

async function loadEnvFile(relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;

    if (INITIAL_ENV_KEYS.has(parsed.key)) {
      continue;
    }

    process.env[parsed.key] = parsed.value;
  }
}

async function loadLocalEnvFiles() {
  await loadEnvFile(".env");
  await loadEnvFile(".env.local");
}

function parseMarketPluginModules(value) {
  if (!value) return [];

  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
}

function expandEnvironmentVariables(value, label) {
  let current = value;
  const seen = new Set([current]);

  for (let depth = 0; depth < 10; depth += 1) {
    const next = current.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, variableName) => {
      const resolved = process.env[variableName];
      if (typeof resolved !== "string" || !resolved.length) {
        throw new Error(`${label} references \${${variableName}}, but that environment variable is not set.`);
      }

      return resolved;
    });

    if (next === current || !/\$\{([A-Z0-9_]+)\}/i.test(next)) {
      return next;
    }

    if (seen.has(next)) {
      throw new Error(`${label} contains a cyclic environment-variable reference.`);
    }

    seen.add(next);
    current = next;
  }

  throw new Error(`${label} exceeded the maximum nested environment-variable expansion depth.`);
}

function parseMarketPluginSources(value) {
  if (!value) return {};

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${MARKET_PLUGIN_SOURCES_ENV} must be valid JSON.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${MARKET_PLUGIN_SOURCES_ENV} must be a JSON object keyed by package name.`);
  }

  const sourceMap = {};

  for (const [moduleName, source] of Object.entries(parsed)) {
    if (typeof source !== "string" || !source.trim()) {
      throw new Error(
        `${MARKET_PLUGIN_SOURCES_ENV}.${moduleName} must be a non-empty dependency source string.`
      );
    }

    sourceMap[moduleName] = expandEnvironmentVariables(
      source.trim(),
      `${MARKET_PLUGIN_SOURCES_ENV}.${moduleName}`
    );
  }

  return sourceMap;
}

function normalizeRelativePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function getVendorDirectory(moduleName) {
  return path.join(GENERATED_PLUGIN_VENDOR_ROOT, ...moduleName.split("/"));
}

async function resolvePluginEntryRelativePath(sourceDirectory) {
  const packageJsonPath = path.join(sourceDirectory, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  const rootExport = packageJson.exports?.["."] ?? packageJson.exports;

  if (typeof rootExport === "string") {
    return normalizeRelativePath(rootExport);
  }

  if (rootExport && typeof rootExport === "object") {
    if (typeof rootExport.import === "string") {
      return normalizeRelativePath(rootExport.import);
    }

    if (typeof rootExport.default === "string") {
      return normalizeRelativePath(rootExport.default);
    }
  }

  if (typeof packageJson.main === "string") {
    return normalizeRelativePath(packageJson.main);
  }

  return "index.js";
}

async function syncLocalPluginVendorSources(modules, sources) {
  await rm(GENERATED_PLUGIN_VENDOR_ROOT, { recursive: true, force: true });

  const generatedImportSpecifiers = new Map();

  for (const moduleName of modules) {
    const source = sources[moduleName];
    if (!source.startsWith("file:")) {
      generatedImportSpecifiers.set(moduleName, moduleName);
      continue;
    }

    const sourceDirectory = path.resolve(process.cwd(), source.slice("file:".length));
    const vendorDirectory = getVendorDirectory(moduleName);
    const entryRelativePath = await resolvePluginEntryRelativePath(sourceDirectory);

    await mkdir(path.dirname(vendorDirectory), { recursive: true });
    await cp(sourceDirectory, vendorDirectory, {
      recursive: true,
      filter(sourcePath) {
        const baseName = path.basename(sourcePath);
        return baseName !== ".git" && baseName !== "node_modules";
      }
    });

    const importPath = normalizeRelativePath(
      path.posix.join(
        ".",
        "vendor",
        ...moduleName.split("/"),
        entryRelativePath.replace(/\\/g, "/")
      )
    );

    generatedImportSpecifiers.set(moduleName, importPath.startsWith(".") ? importPath : `./${importPath}`);
  }

  return generatedImportSpecifiers;
}

function createGeneratedPluginModule(modules, generatedImportSpecifiers) {
  const lines = [
    'import type { MarketPlugin } from "@/lib/market-api/plugins/types";',
    "",
    "export interface InstalledMarketPluginEntry {",
    "  moduleName: string;",
    "  plugin: MarketPlugin;",
    "}",
    ""
  ];

  if (!modules.length) {
    lines.push(
      "export const installedMarketPlugins: readonly InstalledMarketPluginEntry[] = Object.freeze([]);",
      ""
    );

    return lines.join("\n");
  }

  modules.forEach((moduleName, index) => {
    lines.push(
      `import pluginModule${index} from "${generatedImportSpecifiers.get(moduleName) ?? moduleName}";`
    );
  });

  lines.push("");

  modules.forEach((moduleName, index) => {
    lines.push(
      `const normalizedPluginModule${index}: readonly InstalledMarketPluginEntry[] = ` +
        `Object.freeze((Array.isArray(pluginModule${index}) ? pluginModule${index} : [pluginModule${index}]).map((plugin) => ({ moduleName: ${JSON.stringify(moduleName)}, plugin } satisfies InstalledMarketPluginEntry)));`
    );
  });

  lines.push(
    "",
    "export const installedMarketPlugins: readonly InstalledMarketPluginEntry[] = Object.freeze([",
    ...modules.map((_, index) => `  ...normalizedPluginModule${index},`),
    "]);",
    ""
  );

  return lines.join("\n");
}

async function runBunInstall() {
  await new Promise((resolve, reject) => {
    const child = spawn("bun", ["install", "--no-save"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`bun install --no-save exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function main() {
  await loadLocalEnvFiles();

  const modules = parseMarketPluginModules(process.env[MARKET_PLUGIN_MODULES_ENV]);
  const sources = parseMarketPluginSources(process.env[MARKET_PLUGIN_SOURCES_ENV]);
  const missingSources = modules.filter((moduleName) => !sources[moduleName]);

  if (missingSources.length) {
    throw new Error(
      `Missing plugin sources for: ${missingSources.join(", ")}. ` +
        `Add them to ${MARKET_PLUGIN_SOURCES_ENV}.`
    );
  }

  const packageJsonPath = path.join(process.cwd(), "package.json");
  const originalPackageJsonContents = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(originalPackageJsonContents);

  const dependencies =
    packageJson.dependencies &&
    typeof packageJson.dependencies === "object" &&
    !Array.isArray(packageJson.dependencies)
      ? packageJson.dependencies
      : {};

  for (const moduleName of modules) {
    dependencies[moduleName] = sources[moduleName];
  }

  packageJson.dependencies = dependencies;

  const generatedImportSpecifiers = await syncLocalPluginVendorSources(modules, sources);
  const nextPackageJsonContents = `${JSON.stringify(packageJson, null, 2)}\n`;

  await writeFile(
    GENERATED_PLUGIN_FILE_PATH,
    createGeneratedPluginModule(modules, generatedImportSpecifiers)
  );

  if (!modules.length) {
    if (SHOULD_INSTALL) {
      await runBunInstall();
    }
    console.log("No market plugins configured.");
    return;
  }

  if (!SHOULD_INSTALL) {
    await writeFile(packageJsonPath, nextPackageJsonContents);
    console.log(`Injected market plugins: ${modules.join(", ")}`);
    return;
  }

  await writeFile(packageJsonPath, nextPackageJsonContents);
  try {
    await runBunInstall();
  } finally {
    await writeFile(packageJsonPath, originalPackageJsonContents);
  }

  console.log(`Injected market plugins: ${modules.join(", ")}`);
}

await main();
