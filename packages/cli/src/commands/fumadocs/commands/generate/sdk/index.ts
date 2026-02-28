import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getStringFlag, loadJson, parseArgs } from "../../app";

type SDKConfig = {
  entry: string;
  outputDir: string;
  packageName: string;
  title?: string;
  componentImportPath: string;
  componentExportName: string;
  componentFilePath: string;
  browserSafeFunctions?: string[];
};

type RequiredSDKStringField =
  | "entry"
  | "outputDir"
  | "packageName"
  | "componentImportPath"
  | "componentExportName"
  | "componentFilePath";

type LallyConfig = {
  fumadocs?: {
    sdk?: SDKConfig;
  };
};

type ShadcnComponentsConfig = {
  aliases?: {
    ui?: string;
  };
};

type ExportItem = {
  name: string;
  source: string;
};

type ParameterData = {
  name: string;
  type: string;
  optional: boolean;
  description: string;
  example?: string;
  options?: string[];
};

type SignatureData = {
  description: string;
  parameters: ParameterData[];
  returnType: string;
  returnDescription: string;
  exampleCode?: string;
  infoCallout?: { title: string; body: string };
  referencedTypes: ReferencedType[];
};

type ExportDetails = {
  kind: "function" | "value";
  description: string;
  signatures: SignatureData[];
  typeText?: string;
};

type ConstantData = {
  name: string;
  description: string;
  typeText: string;
  typeTableEntries?: Record<string, { description: string; type: string; required: boolean }>;
};

type ReferencedType = {
  name: string;
  description: string;
  type: string;
  docsUrl?: string;
  entries?: Record<string, { description: string; type: string; required: boolean }>;
};

type SDKFunctionPageData = {
  name: string;
  description: string;
  section: string;
  signatures: SignatureData[];
  constants: ConstantData[];
  referencedTypes: ReferencedType[];
};

const PRIMITIVE_AND_SKIP = new Set([
  "string",
  "number",
  "boolean",
  "any",
  "unknown",
  "void",
  "null",
  "undefined",
  "Promise",
  "Array",
  "Record",
  "Set",
  "Map",
  "Object",
  "Function",
]);

function parseNamedExports(source: string): ExportItem[] {
  const items: ExportItem[] = [];
  const re = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(source)) !== null) {
    const names = match[1]
      .split(",")
      .map((n) => n.trim().split(/\s+as\s+/).pop()?.trim())
      .filter(Boolean) as string[];
    const src = match[2];
    for (const name of names) {
      items.push({ name, source: src });
    }
  }

  return items;
}

function toSlug(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toSectionFromSource(source: string): string {
  const cleaned = source.replace(/^\.\/?/, "").replace(/^\//, "");
  const segment = cleaned.split("/")[0] ?? "Other";
  if (!segment || segment === ".") return "Other";
  return segment.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayPartsToString(parts: Array<{ text: string }> | undefined): string {
  return parts?.map((part) => part.text).join("") ?? "";
}

function yamlQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tagText(tag: { text?: Array<{ text: string }> }): string {
  return displayPartsToString(tag.text);
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

function validateSdkConfig(config: SDKConfig | undefined): SDKConfig {
  if (!config) {
    throw new Error(
      [
        "Missing `fumadocs.sdk` in lally.config.json.",
        "Add:",
        "{",
        '  "fumadocs": {',
        '    "sdk": {',
        '      "entry": "../packages/your-sdk/src/index.ts",',
        '      "outputDir": "content/dashboard/sdks/js",',
        '      "packageName": "@your-scope/sdk",',
        '      "componentImportPath": "@/components/sdk-layout",',
        '      "componentExportName": "SDKFunctionPage",',
        '      "componentFilePath": "src/components/sdk-layout/index.ts"',
        "    }",
        "  }",
        "}",
      ].join("\n"),
    );
  }

  const requiredFields: RequiredSDKStringField[] = [
    "entry",
    "outputDir",
    "packageName",
    "componentImportPath",
    "componentExportName",
    "componentFilePath",
  ];

  for (const field of requiredFields) {
    const value = config[field];
    if (!value || !value.trim()) {
      throw new Error(`Missing fumadocs.sdk.${field} in lally.config.json`);
    }
  }

  return config;
}

function extractDocsUrlFromSymbol(ts: typeof import("typescript"), symbol: import("typescript").Symbol, decl?: import("typescript").Declaration): string | undefined {
  const symbolTag = symbol.getJsDocTags().find((tag) => tag.name === "docs");
  const symbolText = symbolTag ? tagText(symbolTag as unknown as { text?: Array<{ text: string }> }).trim() : "";
  if (symbolText) return symbolText;

  if (!decl) return undefined;
  const declarationTags = ts.getJSDocTags(decl);
  for (const tag of declarationTags) {
    if (tag.tagName.getText() !== "docs") continue;
    const comment = typeof tag.comment === "string" ? tag.comment.trim() : "";
    if (comment) return comment;
  }

  return undefined;
}

function extractTypeNamesFromTypeString(typeStr: string): string[] {
  const matches = typeStr.match(/\b([A-Z][a-zA-Z0-9]*)\b/g) ?? [];
  return [...new Set(matches)].filter((n) => !PRIMITIVE_AND_SKIP.has(n));
}

function extractTypeNamesFromEntries(
  entries?: Record<string, { description: string; type: string; required: boolean }>,
): string[] {
  if (!entries) return [];
  const names = new Set<string>();
  for (const entry of Object.values(entries)) {
    for (const name of extractTypeNamesFromTypeString(entry.type)) {
      names.add(name);
    }
  }
  return [...names];
}

function extractPropertiesFromType(
  ts: typeof import("typescript"),
  checker: import("typescript").TypeChecker,
  type: import("typescript").Type,
  decl: import("typescript").Declaration,
): Record<string, { description: string; type: string; required: boolean }> | undefined {
  const props = type.getProperties();
  if (props.length === 0) return undefined;

  const result: Record<string, { description: string; type: string; required: boolean }> = {};
  for (const prop of props) {
    const propDecl = prop.getDeclarations()?.[0];
    const propType = propDecl
      ? checker.getTypeOfSymbolAtLocation(prop, propDecl)
      : checker.getTypeOfSymbolAtLocation(prop, decl);
    const isOptional =
      Boolean(prop.flags & ts.SymbolFlags.Optional) ||
      (propDecl && ts.isPropertySignature(propDecl) && Boolean(propDecl.questionToken));
    const doc = displayPartsToString(prop.getDocumentationComment(checker) as Array<{ text: string }>);
    const propTypeText =
      propDecl &&
      "type" in propDecl &&
      (propDecl as import("typescript").PropertySignature | import("typescript").PropertyDeclaration).type
        ? (
            (propDecl as import("typescript").PropertySignature | import("typescript").PropertyDeclaration).type as import("typescript").TypeNode
          ).getText(propDecl.getSourceFile())
        : checker.typeToString(propType, decl, ts.TypeFormatFlags.NoTruncation);
    const rawDeclText = propDecl ? propDecl.getText(propDecl.getSourceFile()) : "";
    const declTypeMatch = rawDeclText.match(/:\s*([^;]+);?$/s);
    const normalizedPropTypeText =
      propTypeText === "{}" && declTypeMatch?.[1]
        ? declTypeMatch[1].trim()
        : propTypeText;

    result[prop.getName()] = {
      description: doc || "",
      type: normalizedPropTypeText,
      required: !isOptional,
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function extractReferencedType(
  ts: typeof import("typescript"),
  checker: import("typescript").TypeChecker,
  type: import("typescript").Type,
  decl: import("typescript").Declaration,
): ReferencedType | undefined {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (!symbol) return undefined;

  const name = symbol.getName();
  if (name.startsWith("__")) return undefined;
  if (PRIMITIVE_AND_SKIP.has(name)) return undefined;
  if (["Promise", "Array", "Record", "Set", "Map"].includes(name) && !type.aliasSymbol) return undefined;

  const description = displayPartsToString(symbol.getDocumentationComment(checker) as Array<{ text: string }>);
  const typeText = checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation);
  const docsUrl = extractDocsUrlFromSymbol(ts, symbol, symbol.getDeclarations()?.[0]);

  const typeTextIsLiteralUnion = /^"[^"]+"(\s*\|\s*"[^"]+")*$/.test(typeText.trim()) || /^-?\d+(\s*\|\s*-?\d+)*$/.test(typeText.trim());
  const isTemplateLiteralLike = typeText.includes("${") || /did:fide:0x/.test(typeText);
  const isUnionOfLiterals =
    type.isUnion?.() && (type as import("typescript").UnionType).types.every((t) => t.isStringLiteral() || t.isNumberLiteral());
  const isSingleLiteral = type.isStringLiteral?.() || type.isNumberLiteral?.();

  const entries =
    isUnionOfLiterals || isSingleLiteral || typeTextIsLiteralUnion || isTemplateLiteralLike
      ? undefined
      : extractPropertiesFromType(ts, checker, type, decl);

  return {
    name,
    description,
    type: typeText,
    docsUrl,
    entries,
  };
}

function resolveReferencedTypeByName(
  ts: typeof import("typescript"),
  checker: import("typescript").TypeChecker,
  moduleSymbol: import("typescript").Symbol,
  typeName: string,
): ReferencedType | undefined {
  if (PRIMITIVE_AND_SKIP.has(typeName)) return undefined;

  const exports = checker.getExportsOfModule(moduleSymbol);
  const typeSym = exports.find((s) => s.getName() === typeName);
  if (!typeSym) return undefined;

  const resolved = (typeSym.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(typeSym) : typeSym;
  const decl = resolved.getDeclarations()?.[0];
  if (!decl) return undefined;

  const type = checker.getTypeAtLocation(decl);
  const description = displayPartsToString(resolved.getDocumentationComment(checker) as Array<{ text: string }>);
  const typeText = checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation);
  const docsUrl = extractDocsUrlFromSymbol(ts, resolved, decl);

  const typeTextIsLiteralUnion = /^"[^"]+"(\s*\|\s*"[^"]+")*$/.test(typeText.trim()) || /^-?\d+(\s*\|\s*-?\d+)*$/.test(typeText.trim());
  const isTemplateLiteralLike = typeText.includes("${") || /did:fide:0x/.test(typeText);
  const isUnionOfLiterals =
    type.isUnion?.() && (type as import("typescript").UnionType).types.every((t) => t.isStringLiteral() || t.isNumberLiteral());
  const isSingleLiteral = type.isStringLiteral?.() || type.isNumberLiteral?.();

  const entries =
    isUnionOfLiterals || isSingleLiteral || typeTextIsLiteralUnion || isTemplateLiteralLike
      ? undefined
      : extractPropertiesFromType(ts, checker, type, decl);

  return {
    name: typeName,
    description,
    type: typeText,
    docsUrl,
    entries,
  };
}

function extractTypeTableEntries(
  ts: typeof import("typescript"),
  checker: import("typescript").TypeChecker,
  moduleSymbol: import("typescript").Symbol,
  typeText: string,
): Record<string, { description: string; type: string; required: boolean }> | undefined {
  const namedMatch = typeText.match(/^(\w+)$/);
  if (namedMatch) {
    const typeSym = checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === namedMatch[1]);
    if (typeSym) {
      const decl = typeSym.getDeclarations()?.[0];
      if (decl) {
        const type = checker.getTypeAtLocation(decl);
        return extractPropertiesFromType(ts, checker, type, decl);
      }
    }
  }

  const trimmed = typeText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;

  const body = trimmed.slice(1, -1);
  const entries: Record<string, { description: string; type: string; required: boolean }> = {};
  const parts = body.split(";").map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    const match = part.match(/^(?:readonly\s+)?("?)([A-Za-z_$][A-Za-z0-9_$]*)\1(\??):\s*(.+)$/);
    if (!match) continue;
    entries[match[2]] = {
      description: "",
      type: match[4].trim(),
      required: match[3] !== "?",
    };
  }

  return Object.keys(entries).length > 0 ? entries : undefined;
}

function findReferencedConstants(detail: ExportDetails, constantNames: Set<string>): string[] {
  const allText = [
    detail.description,
    ...detail.signatures.flatMap((sig) => [
      sig.description,
      sig.returnDescription,
      sig.exampleCode ?? "",
      ...sig.parameters.map((p) => p.description),
    ]),
  ].join(" ");

  const referenced: string[] = [];
  for (const constantName of constantNames) {
    const regex = new RegExp(`\\b${constantName}\\b`);
    if (regex.test(allText)) referenced.push(constantName);
  }

  return referenced;
}

function isConstant(detail: ExportDetails): boolean {
  return detail.kind === "value";
}

function compareFunctionItems(a: ExportItem, b: ExportItem, browserSafeNames: Set<string>): number {
  if (browserSafeNames.size > 0) {
    const aSafe = browserSafeNames.has(a.name);
    const bSafe = browserSafeNames.has(b.name);
    if (aSafe !== bSafe) return aSafe ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

export async function runGenerateSdkCommand(appRoot: string, rawArgs: string[]): Promise<number> {
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

  let ts: typeof import("typescript");
  try {
    ts = await import("typescript");
  } catch {
    console.error("Missing dependency: typescript. Install it in your workspace to run `lally fumadocs generate sdk`.");
    return 1;
  }

  try {
    const sdkConfig = validateSdkConfig(config.fumadocs?.sdk);
    const sdkEntry = resolve(appRoot, entryOverride ?? sdkConfig.entry);
    const outputDir = resolve(appRoot, outputOverride ?? sdkConfig.outputDir);
    const componentFilePath = resolve(appRoot, sdkConfig.componentFilePath);
    const componentsConfig = await loadJson<ShadcnComponentsConfig>(resolve(appRoot, "components.json"));

    if (!existsSync(sdkEntry)) {
      console.error(`SDK entry file not found: ${sdkEntry}`);
      return 1;
    }

    if (!existsSync(componentFilePath)) {
      console.error(`Configured SDK component file not found: ${componentFilePath}`);
      console.error("Set fumadocs.sdk.componentFilePath to a real file before generating SDK docs.");
      return 1;
    }

    if (!componentsConfig?.aliases?.ui) {
      console.error("Missing components.json aliases.ui; run shadcn init or add a valid ui alias first.");
      return 1;
    }

    const source = await readFile(sdkEntry, "utf8");
    const exportsList = parseNamedExports(source);
    const sourceByName = new Map(exportsList.map((item) => [item.name, item.source]));

    const program = ts.createProgram({
      rootNames: [sdkEntry],
      options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        strict: false,
      },
    });

    const checker = program.getTypeChecker();
    const entryFile = program.getSourceFile(sdkEntry);
    if (!entryFile) {
      console.error(`Unable to load source file into TypeScript program: ${sdkEntry}`);
      return 1;
    }

    const moduleSymbol = checker.getSymbolAtLocation(entryFile);
    if (!moduleSymbol) {
      console.error(`Unable to read exports from SDK entry: ${sdkEntry}`);
      return 1;
    }

    const exportSymbols = checker.getExportsOfModule(moduleSymbol);
    const detailsByName = new Map<string, ExportDetails>();
    const functionExports: ExportItem[] = [];
    const constantExports: ExportItem[] = [];

    for (const exportedSymbol of exportSymbols) {
      const symbol = (exportedSymbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exportedSymbol) : exportedSymbol;
      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0) continue;

      const decl = declarations[0];
      const description = displayPartsToString(symbol.getDocumentationComment(checker) as Array<{ text: string }>);
      const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
      const callSignatures = type.getCallSignatures();

      if (callSignatures.length > 0) {
        const signatures: SignatureData[] = callSignatures.map((signature) => {
          const signatureDescription = displayPartsToString(signature.getDocumentationComment(checker) as Array<{ text: string }>);
          const tags = signature.getJsDocTags();
          const returnTag = tags.find((tag) => tag.name === "returns" || tag.name === "return");
          const paramDefaults = new Map<string, string>();

          for (const tag of tags) {
            if (tag.name !== "paramDefault") continue;
            const raw = tagText(tag as unknown as { text?: Array<{ text: string }> }).trim();
            const match = raw.match(/^(\S+)\s+([\s\S]+)$/);
            if (!match) continue;
            paramDefaults.set(match[1], match[2].trim());
          }

          const referencedTypes: ReferencedType[] = [];
          const seenTypes = new Set<string>();

          const addType = (t: import("typescript").Type, d: import("typescript").Declaration) => {
            const ref = extractReferencedType(ts, checker, t, d);
            if (ref && !seenTypes.has(ref.name)) {
              referencedTypes.push(ref);
              seenTypes.add(ref.name);
            }
          };

          const addTypeByName = (typeName: string) => {
            const ref = resolveReferencedTypeByName(ts, checker, moduleSymbol, typeName);
            if (ref && !seenTypes.has(ref.name)) {
              referencedTypes.push(ref);
              seenTypes.add(ref.name);
            }
          };

          const expandReferencedTypesRecursively = () => {
            let changed = true;
            while (changed) {
              changed = false;
              const snapshot = [...referencedTypes];
              for (const ref of snapshot) {
                for (const nestedName of extractTypeNamesFromEntries(ref.entries)) {
                  if (seenTypes.has(nestedName)) continue;
                  const before = seenTypes.size;
                  addTypeByName(nestedName);
                  if (seenTypes.size > before) changed = true;
                }
              }
            }
          };

          const parameters: ParameterData[] = signature.getParameters().map((paramSymbol) => {
            const paramDecl = paramSymbol.valueDeclaration ?? paramSymbol.declarations?.[0];
            const paramDeclOrFallback = paramDecl ?? decl;
            const paramType = checker.getTypeOfSymbolAtLocation(paramSymbol, paramDeclOrFallback);
            addType(paramType, paramDeclOrFallback);

            let paramTypeText: string;
            if (paramDecl && ts.isParameter(paramDecl) && paramDecl.type) {
              paramTypeText = paramDecl.type.getText(paramDecl.getSourceFile());
            } else {
              paramTypeText = checker.typeToString(paramType, decl, ts.TypeFormatFlags.NoTruncation);
            }

            for (const name of extractTypeNamesFromTypeString(paramTypeText)) {
              addTypeByName(name);
            }

            const isOptional =
              Boolean(paramSymbol.flags & ts.SymbolFlags.Optional) ||
              (ts.isParameter(paramDeclOrFallback as import("typescript").Node) &&
                (Boolean((paramDeclOrFallback as import("typescript").ParameterDeclaration).questionToken) ||
                  Boolean((paramDeclOrFallback as import("typescript").ParameterDeclaration).initializer)));

            const paramTag = tags.find(
              (tag) =>
                tag.name === "param" &&
                tagText(tag as unknown as { text?: Array<{ text: string }> }).startsWith(`${paramSymbol.getName()} `),
            );

            const paramDescriptionText = paramTag
              ? tagText(paramTag as unknown as { text?: Array<{ text: string }> }).replace(new RegExp(`^${paramSymbol.getName()}\\s*-?\\s*`), "")
              : "";

            const example = paramDefaults.get(paramSymbol.getName());

            const paramTypeSymbol = checker.getTypeOfSymbolAtLocation(paramSymbol, paramDeclOrFallback);
            let options: string[] | undefined;
            if (paramTypeSymbol.isUnion()) {
              const parts = paramTypeSymbol.types;
              if (parts.every((p) => p.isStringLiteral())) {
                options = parts.map((p) => (p as import("typescript").StringLiteralType).value);
              } else if (parts.every((p) => p.isNumberLiteral())) {
                options = parts.map((p) => String((p as import("typescript").NumberLiteralType).value));
              }
            } else if (paramTypeSymbol.isStringLiteral?.()) {
              options = [paramTypeSymbol.value];
            } else if (paramTypeSymbol.isNumberLiteral?.()) {
              options = [String(paramTypeSymbol.value)];
            }

            return {
              name: paramSymbol.getName(),
              type: paramTypeText,
              optional: isOptional,
              description: paramDescriptionText.trim(),
              example,
              options,
            };
          });

          const returnTypeSymbol = signature.getReturnType();
          addType(returnTypeSymbol, decl);
          const signatureDecl = signature.getDeclaration();
          const returnType =
            signatureDecl && "type" in signatureDecl && signatureDecl.type
              ? signatureDecl.type.getText(signatureDecl.getSourceFile())
              : checker.typeToString(returnTypeSymbol, decl, ts.TypeFormatFlags.NoTruncation);
          for (const name of extractTypeNamesFromTypeString(returnType)) {
            addTypeByName(name);
          }
          expandReferencedTypesRecursively();

          const exampleTag = tags.find((tag) => tag.name === "example");
          let exampleCode: string | undefined;
          if (exampleTag) {
            const raw = tagText(exampleTag as unknown as { text?: Array<{ text: string }> });
            const match = raw.match(/```(?:ts|typescript)?\s*\n?([\s\S]*?)```/);
            exampleCode = match ? match[1].trim() : raw.trim();
            if (exampleCode) exampleCode = exampleCode.replace(/^\s*\*\s?/gm, "");
          }

          const infoCalloutTag = tags.find((tag) => tag.name === "infoCallout");
          let infoCallout: { title: string; body: string } | undefined;
          if (infoCalloutTag) {
            const raw = tagText(infoCalloutTag as unknown as { text?: Array<{ text: string }> }).trim();
            const firstNewline = raw.indexOf("\n");
            const title = firstNewline > 0 ? raw.slice(0, firstNewline).trim() : raw;
            const body = firstNewline > 0 ? raw.slice(firstNewline).trim() : "";
            if (title) infoCallout = { title, body };
          }

          return {
            description: signatureDescription,
            parameters,
            returnType,
            returnDescription: returnTag
              ? tagText(returnTag as unknown as { text?: Array<{ text: string }> }).replace(/^-\s*/, "")
              : "",
            exampleCode,
            infoCallout,
            referencedTypes,
          };
        });

        detailsByName.set(exportedSymbol.getName(), {
          kind: "function",
          description,
          signatures,
        });
      } else {
        detailsByName.set(exportedSymbol.getName(), {
          kind: "value",
          description,
          signatures: [],
          typeText: checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation),
        });
      }

      const sourceFromExport = sourceByName.get(exportedSymbol.getName());
      const declarationPath = decl.getSourceFile()?.fileName;
      const fallbackSource = declarationPath ? declarationPath.replace(`${dirname(sdkEntry)}/`, "") : "other";
      const item: ExportItem = {
        name: exportedSymbol.getName(),
        source: sourceFromExport ?? fallbackSource,
      };

      const detail = detailsByName.get(item.name);
      if (!detail) continue;
      if (isConstant(detail)) {
        constantExports.push(item);
      } else {
        functionExports.push(item);
      }
    }

    const browserSafeNames = new Set(sdkConfig.browserSafeFunctions ?? []);
    const grouped = new Map<string, ExportItem[]>();
    for (const item of functionExports) {
      if (item.source.includes("/examples") || item.source.includes("/docs-examples")) continue;
      const section =
        browserSafeNames.size > 0
          ? browserSafeNames.has(item.name)
            ? "Browser Safe"
            : "Node Runtime"
          : toSectionFromSource(item.source);
      const list = grouped.get(section) ?? [];
      list.push(item);
      grouped.set(section, list);
    }

    const orderedSections =
      browserSafeNames.size > 0
        ? [...grouped.keys()].sort((a, b) => {
            const rank = (value: string): number => {
              if (value === "Browser Safe") return 0;
              if (value === "Node Runtime") return 1;
              return 2;
            };
            return rank(a) - rank(b) || a.localeCompare(b);
          })
        : [...grouped.keys()].sort((a, b) => a.localeCompare(b));

    const constantNames = new Set(constantExports.map((c) => c.name));
    const constantsByFunction = new Map<string, ConstantData[]>();

    for (const funcItem of functionExports) {
      const funcDetail = detailsByName.get(funcItem.name);
      if (!funcDetail || funcDetail.kind !== "function") continue;

      const referencedConstantNames = findReferencedConstants(funcDetail, constantNames);
      if (referencedConstantNames.length === 0) continue;

      const constants: ConstantData[] = [];
      for (const constName of referencedConstantNames) {
        const constDetail = detailsByName.get(constName);
        if (!constDetail || constDetail.kind !== "value") continue;

        const typeText = constDetail.typeText ?? "unknown";
        const typeTableEntries = extractTypeTableEntries(ts, checker, moduleSymbol, typeText);

        constants.push({
          name: constName,
          description: constDetail.description,
          typeText,
          typeTableEntries,
        });
      }

      if (constants.length > 0) {
        constantsByFunction.set(funcItem.name, constants);
      }
    }

    let totalWritten = 0;
    if (!dryRun) {
      await cleanGeneratedMdx(outputDir);
    }

    for (const section of orderedSections) {
      const items = grouped.get(section) ?? [];
      for (const item of items) {
        const detail = detailsByName.get(item.name);
        if (!detail || detail.kind !== "function") continue;
        const isBrowserSafe = browserSafeNames.has(item.name);

        const constants = constantsByFunction.get(item.name) ?? [];
        const referencedTypes: ReferencedType[] = [];
        const seenTypes = new Set<string>();
        const signatures = detail.signatures.map((sig) => {
          if (isBrowserSafe || sig.infoCallout) return sig;
          return {
            ...sig,
            infoCallout: {
              title: "Node Runtime Required",
              body: "This function requires a Node.js runtime and is disabled in the browser docs preview.",
            },
          };
        });
        for (const sig of signatures) {
          for (const ref of sig.referencedTypes) {
            if (seenTypes.has(ref.name)) continue;
            referencedTypes.push(ref);
            seenTypes.add(ref.name);
          }
        }

        const data: SDKFunctionPageData = {
          name: item.name,
          description: detail.description,
          section,
          signatures,
          constants,
          referencedTypes,
        };

        const slug = toSlug(item.name);
        const mdx = `---\ntitle: ${yamlQuoted(item.name)}\ndescription: ${yamlQuoted(
          detail.description || `SDK reference for ${item.name}`,
        )}\nfull: true\n---\n\nimport { ${sdkConfig.componentExportName} } from '${sdkConfig.componentImportPath}';\n\n<${sdkConfig.componentExportName} data={${JSON.stringify(data)}} />\n`;

        if (!dryRun) {
          await writeFile(resolve(outputDir, `${slug}.mdx`), mdx, "utf8");
        }
        totalWritten += 1;
      }
    }

    const pages: string[] = ["index"];
    for (const section of orderedSections) {
      const items = grouped.get(section) ?? [];
      if (items.length === 0) continue;
      pages.push(`--- ${section} ---`);
      const sorted = [...items].sort((a, b) => compareFunctionItems(a, b, browserSafeNames));
      for (const item of sorted) {
        pages.push(toSlug(item.name));
      }
    }

    const sectionLinks = orderedSections
      .map((section) => {
        const items = grouped.get(section) ?? [];
        const sorted = [...items].sort((a, b) => compareFunctionItems(a, b, browserSafeNames));
        const links = sorted.map((item) => `  - [\`${item.name}\`](./${toSlug(item.name)})`).join("\n");
        return `### ${section}\n\n${links}`;
      })
      .join("\n\n");

    const sdkTitle = (sdkConfig.title ?? "SDKs").trim() || "SDKs";
    const indexMdx = `---\ntitle: ${yamlQuoted(sdkTitle)}\ndescription: ${yamlQuoted(`Complete API surface for ${sdkConfig.packageName}`)}\n---\n\n${sectionLinks}\n`;

    if (!dryRun) {
      await writeFile(resolve(outputDir, "index.mdx"), indexMdx, "utf8");
      await writeFile(
        resolve(outputDir, "meta.json"),
        `${JSON.stringify(
          {
            title: sdkTitle,
            description: "Generated SDK reference",
            root: true,
            defaultOpen: false,
            icon: "Box",
            pages,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }

    console.log(`${dryRun ? "[dry-run] " : ""}Generated ${totalWritten} SDK function pages in ${outputDir}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
