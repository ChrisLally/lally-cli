import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getStringFlag, loadJson, parseArgs } from "../../app";

type CLIConfig = {
  entry: string;
  outputDir: string;
  packageName: string;
  componentImportPath: string;
  componentExportName: string;
  componentFilePath: string;
  sources?: string[];
};

type LallyConfig = {
  fumadocs?: {
    cli?: CLIConfig;
  };
};

type ShadcnComponentsConfig = {
  aliases?: {
    ui?: string;
  };
};

type CLIArgumentData = {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
};

type CLIOptionData = {
  name: string;
  shorthand?: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  description?: string;
};

type CLIExampleData = {
  label?: string;
  command: string;
  description?: string;
};

type CLISubcommandData = {
  name: string;
  summary?: string;
};

type CLINoteData = {
  title?: string;
  body: string;
};

type CLICommandPageData = {
  name: string;
  summary?: string;
  description?: string;
  usage: string[];
  arguments?: CLIArgumentData[];
  options?: CLIOptionData[];
  subcommands?: CLISubcommandData[];
  examples?: CLIExampleData[];
  notes?: CLINoteData[];
};

type HelpDoc = {
  id: string;
  title: string;
  lines: string[];
  sourceFile: string;
  description?: string;
};

function yamlQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function toSlug(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function parseQuotedLiteral(raw: string): string {
  const quote = raw[0];
  if ((quote !== '"' && quote !== "'") || raw[raw.length - 1] !== quote) return raw;

  let out = "";
  for (let i = 1; i < raw.length - 1; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= raw.length - 1) break;
    const next = raw[i];
    if (next === "n") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "r") out += "\r";
    else out += next;
  }

  return out;
}

function captureFunctionBody(source: string, fnName: string): string | null {
  const marker = `function ${fnName}`;
  const start = source.indexOf(marker);
  if (start < 0) return null;

  const openBrace = source.indexOf("{", start);
  if (openBrace < 0) return null;

  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, i);
      }
    }
  }

  return null;
}

function captureFunctionJsDoc(source: string, fnName: string): string | null {
  const functionRe = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?function\\s+${fnName}\\s*\\(`, "m");
  const functionMatch = source.match(functionRe);
  if (!functionMatch || typeof functionMatch.index !== "number") return null;

  const fnStart = functionMatch.index + functionMatch[0].search(/(?:export\s+)?function/);

  const commentStart = source.lastIndexOf("/**", fnStart);
  if (commentStart < 0) return null;
  const commentEnd = source.indexOf("*/", commentStart);
  if (commentEnd < 0 || commentEnd > fnStart) return null;

  const between = source.slice(commentEnd + 2, fnStart);
  if (between.trim()) return null;

  return source.slice(commentStart, commentEnd + 2);
}

function extractDescriptionTag(jsdoc: string | null): string | undefined {
  if (!jsdoc) return undefined;
  const body = jsdoc
    .replace(/^\/\*\*|\*\/$/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n");

  const tagMatch = body.match(/@description\s+([\s\S]*?)(?:\n\s*@\w+|$)/);
  if (!tagMatch?.[1]) return undefined;

  const normalized = tagMatch[1].trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function extractStringLiteralsFromArrayLiteral(raw: string): string[] {
  const matches = raw.match(/(["'])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
  return matches.map((token) => parseQuotedLiteral(token));
}

function extractHelpFromArrayBody(fnBody: string): string[] {
  const returnArrayMatch = fnBody.match(/return\s*\[([\s\S]*?)\]\s*\.join\(\s*["']\\n["']\s*\)/);
  if (!returnArrayMatch) return [];
  return extractStringLiteralsFromArrayLiteral(returnArrayMatch[1]).map((line) => line.trimEnd());
}

function extractHelpFromConsoleLogs(fnBody: string): string[] {
  const logs: string[] = [];
  const logRe = /console\.log\(\s*((["'])(?:\\.|(?!\2)[^\\])*\2)\s*\)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = logRe.exec(fnBody)) !== null) {
    logs.push(parseQuotedLiteral(match[1]).trimEnd());
  }
  return logs;
}

function commandTitleFromUsageLine(usageLine: string): string {
  const trimmed = usageLine.trim();
  if (!trimmed.startsWith("lally ")) return "lally";
  const rest = trimmed.slice("lally ".length).trim();
  const pieces = rest.split(/\s+/);
  const domain = pieces[0] ?? "lally";
  const firstArg = pieces[1] ?? "";
  if (!firstArg || firstArg.startsWith("<")) return `lally ${domain}`;
  return `lally ${domain} ${firstArg}`;
}

function extractCommandTitle(lines: string[], fallback: string): string {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("lally ")) return commandTitleFromUsageLine(trimmed);
  }
  return fallback;
}

function extractSection(lines: string[], heading: string): string[] {
  const headingIndex = lines.findIndex((line) => line.trim() === `${heading}:`);
  if (headingIndex < 0) return [];

  const result: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const current = lines[i];
    const trimmed = current.trim();
    if (!trimmed) {
      if (result.length === 0) continue;
      break;
    }
    if (/^[A-Za-z][A-Za-z ]+:$/.test(trimmed)) break;
    result.push(trimmed);
  }
  return result;
}

function stripIndent(value: string): string {
  return value.replace(/^\s+/, "");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toBaseCommandTokens(commandName: string): string[] {
  const pieces = normalizeWhitespace(commandName).split(" ").filter(Boolean);
  return pieces;
}

function inferSubcommandsFromExamples(commandName: string, usage: string[], examples: CLIExampleData[]): CLISubcommandData[] {
  const base = toBaseCommandTokens(commandName);
  if (base.length < 2 || commandName.includes("<")) return [];
  if (base.length > 2) return [];

  const seen = new Set<string>();
  const result: CLISubcommandData[] = [];
  for (const example of examples) {
    const tokens = normalizeWhitespace(example.command).split(" ");
    const baseMatches = base.every((token, index) => tokens[index] === token);
    if (!baseMatches || tokens.length <= base.length) continue;

    const next = tokens[base.length];
    if (!next || next.startsWith("-")) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    result.push({
      name: `${commandName} ${next}`,
    });
  }

  return result;
}

function inferSubcommandsFromUsage(commandName: string, usage: string[]): CLISubcommandData[] {
  const base = toBaseCommandTokens(commandName);
  if (base.length !== 2 || commandName.includes("<")) return [];

  const enumMatch = usage
    .map((line) => line.match(/^lally\s+[^\s]+\s+<([^>]+)>/i))
    .find((match) => Boolean(match?.[1]?.includes("|")));

  if (!enumMatch?.[1]) return [];

  return enumMatch[1]
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) => ({ name: `${commandName} ${name}` }));
}

function parseSubcommands(lines: string[]): CLISubcommandData[] {
  const section = extractSection(lines, "Domain usage");
  const result: CLISubcommandData[] = [];
  for (const line of section) {
    if (!line.startsWith("lally ")) continue;
    const noExtra = line.replace(/\[options\]|\[\.\.\.args\]/g, "").trim();
    const summaryMatch = noExtra.match(/^lally\s+([a-z0-9-]+)\s+<([^>]+)>/i);
    if (summaryMatch) {
      result.push({
        name: `lally ${summaryMatch[1]}`,
        summary: summaryMatch[2].split("|").map((s) => s.trim()).join(", "),
      });
      continue;
    }

    const tokens = noExtra.split(/\s+/);
    if (tokens.length >= 3) {
      const name = `lally ${tokens[1]} ${tokens[2]}`;
      result.push({ name });
    }
  }
  return result;
}

function parseOptions(lines: string[], usage: string[]): CLIOptionData[] {
  const options = new Map<string, CLIOptionData>();

  const addOption = (option: CLIOptionData) => {
    const key = option.name;
    if (!key) return;
    const existing = options.get(key);
    if (!existing) {
      options.set(key, option);
      return;
    }
    options.set(key, {
      ...existing,
      shorthand: existing.shorthand || option.shorthand,
      type: existing.type || option.type,
      required: existing.required ?? option.required,
      defaultValue: existing.defaultValue || option.defaultValue,
      description: existing.description || option.description,
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-") && !trimmed.startsWith("--")) continue;

    const [head, ...tail] = trimmed.split(/\s{2,}/);
    const description = tail.join(" ").trim();
    const names = head.split(",").map((part) => part.trim());
    const long = names.find((name) => name.startsWith("--")) ?? names[0];
    const short = names.find((name) => name.startsWith("-") && !name.startsWith("--"));

    const typeMatch = long.match(/<([^>]+)>/);
    const name = long.replace(/<[^>]+>/g, "").trim();

    addOption({
      name,
      shorthand: short,
      type: typeMatch?.[1],
      description: description || undefined,
    });
  }

  const usageOptionRe = /\[(--[a-z0-9-]+)(?:\s+<([^>]+)>)?\]|(--[a-z0-9-]+)(?:\s+<([^>]+)>)?/gi;
  for (const line of usage) {
    let match: RegExpExecArray | null;
    while ((match = usageOptionRe.exec(line)) !== null) {
      const name = match[1] || match[3];
      const type = match[2] || match[4];
      if (!name) continue;
      const isRequired = !match[1];
      addOption({
        name,
        type: type || undefined,
        required: isRequired,
      });
    }
  }

  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseOptionsFromExamples(commandName: string, examples: CLIExampleData[]): CLIOptionData[] {
  const base = toBaseCommandTokens(commandName);
  if (base.length < 2) return [];

  const result = new Map<string, CLIOptionData>();
  for (const example of examples) {
    const tokens = normalizeWhitespace(example.command).split(" ");
    const baseMatches = base.every((token, index) => tokens[index] === token);
    if (!baseMatches) continue;

    for (let i = base.length; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token.startsWith("--")) continue;
      const next = tokens[i + 1];
      const hasValue = Boolean(next && !next.startsWith("-"));
      const existing = result.get(token);
      const option: CLIOptionData = {
        name: token,
        required: false,
        type: hasValue ? existing?.type : existing?.type,
      };
      result.set(token, existing ? { ...existing, ...option } : option);
      if (hasValue) i += 1;
    }
  }

  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseUsageArguments(usage: string[]): CLIArgumentData[] {
  const args = new Map<string, CLIArgumentData>();
  const positionalTokenRe = /(?:^|\s)(<([^>]+)>)/g;

  for (const line of usage) {
    let match: RegExpExecArray | null;
    while ((match = positionalTokenRe.exec(line)) !== null) {
      const token = match[1];
      const name = match[2];
      if (!name || name.includes("|")) continue;
      if (name === "domain" || name === "command" || name === "target" || name === "tag") continue;
      const prefix = line.slice(0, match.index + token.length + 1).trimEnd();
      const beforeToken = prefix.slice(0, -token.length).trimEnd();
      if (beforeToken.endsWith("--app") || /--[a-z0-9-]+$/i.test(beforeToken)) continue;
      if (!args.has(name)) {
        args.set(name, {
          name: `<${name}>`,
          required: true,
        });
      }
    }
  }
  return [...args.values()];
}

function toPageData(doc: HelpDoc): CLICommandPageData {
  const usageRaw = extractSection(doc.lines, "Usage").map(stripIndent).filter(Boolean);
  const examplesRaw = extractSection(doc.lines, "Examples").map(stripIndent).filter(Boolean);
  const optionsRaw = extractSection(doc.lines, "Options").map(stripIndent).filter(Boolean);
  const domainUsageRaw = extractSection(doc.lines, "Domain usage").map(stripIndent).filter(Boolean);
  const notesRaw = extractSection(doc.lines, "Notes").map(stripIndent).filter(Boolean);
  const configRaw = extractSection(doc.lines, "Config").map(stripIndent).filter(Boolean);
  const targetsRaw = extractSection(doc.lines, "Targets").map(stripIndent).filter(Boolean);
  const presetsRaw = extractSection(doc.lines, "Presets").map(stripIndent).filter(Boolean);
  const authRaw = extractSection(doc.lines, "Auth resolution (first match wins)").map(stripIndent).filter(Boolean);

  const usage = usageRaw.length > 0 ? usageRaw : [`lally ${doc.id}`];
  const firstLine = doc.lines[0]?.trim() ?? "";
  const summary = firstLine && !firstLine.includes(":") && firstLine !== "lally" ? firstLine : undefined;

  const examples: CLIExampleData[] = examplesRaw
    .filter((line) => line.startsWith("lally "))
    .map((line) => ({ command: line }));

  const notes: CLINoteData[] = [];
  if (domainUsageRaw.length > 0) {
    notes.push({
      title: "Domain Usage",
      body: domainUsageRaw.join("\n"),
    });
  }
  if (targetsRaw.length > 0) {
    notes.push({
      title: "Targets",
      body: targetsRaw.join("\n"),
    });
  }
  if (presetsRaw.length > 0) {
    notes.push({
      title: "Presets",
      body: presetsRaw.join("\n"),
    });
  }
  if (configRaw.length > 0) {
    notes.push({
      title: "Config",
      body: configRaw.join("\n"),
    });
  }
  if (notesRaw.length > 0) {
    notes.push({
      title: "Notes",
      body: notesRaw.join("\n"),
    });
  }
  if (authRaw.length > 0) {
    notes.push({
      title: "Auth Resolution",
      body: authRaw.join("\n"),
    });
  }

  const optionsFromSections = parseOptions(optionsRaw, usage);
  const optionsFromExamples = parseOptionsFromExamples(doc.title, examples);
  const optionsByName = new Map<string, CLIOptionData>();
  for (const option of [...optionsFromSections, ...optionsFromExamples]) {
    const existing = optionsByName.get(option.name);
    if (!existing) {
      optionsByName.set(option.name, option);
      continue;
    }
    optionsByName.set(option.name, {
      ...existing,
      shorthand: existing.shorthand || option.shorthand,
      type: existing.type || option.type,
      required: existing.required ?? option.required,
      defaultValue: existing.defaultValue || option.defaultValue,
      description: existing.description || option.description,
    });
  }
  const options = [...optionsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const argumentsList = parseUsageArguments(usage);
  const parsedSubcommands = parseSubcommands(doc.lines);
  const usageEnumSubcommands = inferSubcommandsFromUsage(doc.title, usage);
  const inferredSubcommands = inferSubcommandsFromExamples(doc.title, usage, examples);
  const subcommandsMap = new Map<string, CLISubcommandData>();
  for (const subcommand of [...parsedSubcommands, ...usageEnumSubcommands, ...inferredSubcommands]) {
    const existing = subcommandsMap.get(subcommand.name);
    if (!existing) {
      subcommandsMap.set(subcommand.name, subcommand);
      continue;
    }
    subcommandsMap.set(subcommand.name, {
      name: subcommand.name,
      summary: existing.summary || subcommand.summary,
    });
  }
  const subcommands = [...subcommandsMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: doc.title,
    summary,
    description: doc.description,
    usage,
    arguments: argumentsList.length > 0 ? argumentsList : undefined,
    options: options.length > 0 ? options : undefined,
    subcommands: subcommands.length > 0 ? subcommands : undefined,
    examples: examples.length > 0 ? examples : undefined,
    notes: notes.length > 0 ? notes : undefined,
  };
}

async function cleanGeneratedMdx(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const files = await readdir(dir);
  for (const file of files) {
    if (file.endsWith(".mdx") && file !== "index.mdx") {
      await rm(resolve(dir, file));
    }
  }
}

function validateCliConfig(config: CLIConfig | undefined): CLIConfig {
  if (!config) {
    throw new Error(
      [
        "Missing `fumadocs.cli` in lally.config.json.",
        "Add:",
        "{",
        '  "fumadocs": {',
        '    "cli": {',
        '      "entry": "../../packages/lally-cli/packages/cli/src/main.ts",',
        '      "outputDir": "content/docs/cli",',
        '      "packageName": "@your-scope/cli",',
        '      "componentImportPath": "@/cli-layout",',
        '      "componentExportName": "CLICommandPage",',
        '      "componentFilePath": "src/cli-layout/index.ts"',
        "    }",
        "  }",
        "}",
      ].join("\n"),
    );
  }

  const requiredFields: Array<keyof CLIConfig> = [
    "entry",
    "outputDir",
    "packageName",
    "componentImportPath",
    "componentExportName",
    "componentFilePath",
  ];

  for (const field of requiredFields) {
    const value = config[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Missing fumadocs.cli.${field} in lally.config.json`);
    }
  }

  return config;
}

async function extractDocsFromSource(sourcePath: string): Promise<HelpDoc[]> {
  const source = await readFile(sourcePath, "utf8");
  const docs: HelpDoc[] = [];

  const arrayHelpFunctionRegex = /function\s+([A-Za-z0-9_]*help[A-Za-z0-9_]*)\s*\([^)]*\)\s*:\s*string\s*\{/gi;
  let helpFnMatch: RegExpExecArray | null;
  while ((helpFnMatch = arrayHelpFunctionRegex.exec(source)) !== null) {
    const fnName = helpFnMatch[1];
    const body = captureFunctionBody(source, fnName);
    if (!body) continue;

    const lines = extractHelpFromArrayBody(body);
    if (lines.length === 0) continue;
    const description = extractDescriptionTag(captureFunctionJsDoc(source, fnName));
    if (!description) {
      throw new Error(`Missing @description JSDoc tag for ${fnName} in ${sourcePath}`);
    }

    const id = toSlug(fnName.replace(/help/gi, "")) || "command";
    docs.push({
      id,
      title: extractCommandTitle(lines, fnName),
      lines,
      sourceFile: sourcePath,
      description,
    });
  }

  const printHelpBody = captureFunctionBody(source, "printHelp");
  if (printHelpBody) {
    const lines = extractHelpFromConsoleLogs(printHelpBody);
    if (lines.length > 0) {
      const description = extractDescriptionTag(captureFunctionJsDoc(source, "printHelp"));
      if (!description) {
        throw new Error(`Missing @description JSDoc tag for printHelp in ${sourcePath}`);
      }
      docs.push({
        id: "lally",
        title: extractCommandTitle(lines, "lally"),
        lines,
        sourceFile: sourcePath,
        description,
      });
    }
  }

  return docs;
}

function dedupeDocs(docs: HelpDoc[]): HelpDoc[] {
  const byId = new Map<string, HelpDoc>();
  for (const doc of docs) {
    const existing = byId.get(doc.id);
    if (!existing || existing.lines.length < doc.lines.length) {
      byId.set(doc.id, doc);
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function runGenerateCliCommand(appRoot: string, rawArgs: string[]): Promise<number> {
  const { flags } = parseArgs(["_", ...rawArgs]);
  const dryRun = flags.get("dry-run") === true;
  const entryOverride = getStringFlag(flags, "entry");
  const outputOverride = getStringFlag(flags, "out");

  const configPath = resolve(appRoot, "lally.config.json");
  const config = await loadJson<LallyConfig>(configPath);
  if (!config) {
    console.error("Missing lally.config.json in app root. Run `lally fumadocs init --app <path>` first.");
    return 1;
  }

  try {
    const cliConfig = validateCliConfig(config.fumadocs?.cli);
    const entryPath = resolve(appRoot, entryOverride ?? cliConfig.entry);
    const outputDir = resolve(appRoot, outputOverride ?? cliConfig.outputDir);
    const componentFilePath = resolve(appRoot, cliConfig.componentFilePath);
    const componentsConfig = await loadJson<ShadcnComponentsConfig>(resolve(appRoot, "components.json"));

    if (!existsSync(entryPath)) {
      console.error(`CLI entry file not found: ${entryPath}`);
      return 1;
    }

    if (!existsSync(componentFilePath)) {
      console.error(`Configured CLI component file not found: ${componentFilePath}`);
      console.error("Set fumadocs.cli.componentFilePath to a real file before generating CLI docs.");
      return 1;
    }

    if (!componentsConfig?.aliases?.ui) {
      console.error("Missing components.json aliases.ui; run shadcn init or add a valid ui alias first.");
      return 1;
    }

    const sources = [entryPath, ...(cliConfig.sources ?? []).map((file) => resolve(appRoot, file))];
    const docsNested = await Promise.all(
      sources.map(async (file) => {
        if (!existsSync(file)) {
          throw new Error(`Configured CLI source file not found: ${file}`);
        }
        return extractDocsFromSource(file);
      }),
    );

    const docs = dedupeDocs(docsNested.flat());
    if (docs.length === 0) {
      console.error("No CLI help docs discovered from configured sources.");
      return 1;
    }

    if (!dryRun) {
      await cleanGeneratedMdx(outputDir);
    }

    let written = 0;
    const slugs: string[] = [];
    for (const doc of docs) {
      const slug = toSlug(doc.id);
      const pageData = toPageData(doc);
      if (!pageData.description) {
        throw new Error(`Missing @description-derived page description for command: ${pageData.name}`);
      }
      const description = pageData.description;
      const mdx = `---\ntitle: ${yamlQuoted(pageData.name)}\ndescription: ${yamlQuoted(
        description,
      )}\nfull: true\n---\n\nimport { ${cliConfig.componentExportName} } from '${cliConfig.componentImportPath}';\n\n<${cliConfig.componentExportName} data={${JSON.stringify(pageData)}} />\n`;

      if (!dryRun) {
        await writeFile(resolve(outputDir, `${slug}.mdx`), mdx, "utf8");
      }
      slugs.push(slug);
      written += 1;
    }

    const sectionLinks = docs
      .map((doc) => {
        const slug = toSlug(doc.id);
        return `- [\`${doc.title}\`](./${slug})`;
      })
      .join("\n");

    const indexMdx = `---\ntitle: CLI\ndescription: ${yamlQuoted(`Command reference for ${cliConfig.packageName}`)}\n---\n\n${sectionLinks}\n`;
    const pages = ["index", ...slugs];

    if (!dryRun) {
      await writeFile(resolve(outputDir, "index.mdx"), indexMdx, "utf8");
      await writeFile(
        resolve(outputDir, "meta.json"),
        `${JSON.stringify(
          {
            title: "CLI",
            description: "Generated CLI reference",
            root: true,
            defaultOpen: false,
            icon: "Terminal",
            pages,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }

    console.log(`${dryRun ? "[dry-run] " : ""}Generated ${written} CLI pages in ${outputDir}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
