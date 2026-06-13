import { XMLParser } from "fast-xml-parser";

export type FlatRow = Record<string, string>;

export interface ParseResult {
  rows: FlatRow[];
  columns: string[];
  rootPath: string;
  recordCount: number;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  textNodeName: "#text",
});

function flatten(obj: unknown, prefix = "", out: FlatRow = {}): FlatRow {
  if (obj === null || obj === undefined) {
    if (prefix) out[prefix] = "";
    return out;
  }
  if (typeof obj !== "object") {
    out[prefix || "value"] = String(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    // For arrays at leaf, join scalars; for object arrays, index them
    const scalars = obj.every((v) => typeof v !== "object" || v === null);
    if (scalars) {
      out[prefix || "value"] = obj.map((v) => (v == null ? "" : String(v))).join("|");
    } else {
      obj.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
    }
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    flatten(v, key, out);
  }
  return out;
}

/**
 * Find the deepest array of objects in the parsed XML — this is the "records" set.
 * Returns the array and the dot-path to it.
 */
function findRecordCollection(
  node: unknown,
  path = "",
): { arr: unknown[]; path: string } | null {
  if (!node || typeof node !== "object") return null;
  let best: { arr: unknown[]; path: string } | null = null;

  const visit = (n: unknown, p: string) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      const objCount = n.filter((x) => x && typeof x === "object" && !Array.isArray(x)).length;
      if (objCount >= 1 && (!best || n.length > best.arr.length)) {
        best = { arr: n, path: p };
      }
      n.forEach((c, i) => visit(c, `${p}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      visit(v, p ? `${p}.${k}` : k);
    }
  };
  visit(node, path);
  return best;
}

export function parseXmlToRows(xml: string): ParseResult {
  const parsed = parser.parse(xml);
  const collection = findRecordCollection(parsed);

  if (collection && collection.arr.length > 1) {
    const rows = collection.arr.map((item) => flatten(item));
    const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    return {
      rows,
      columns: cols,
      rootPath: collection.path,
      recordCount: rows.length,
    };
  }

  // Fallback: single record from the whole document
  const single = flatten(parsed);
  return {
    rows: [single],
    columns: Object.keys(single),
    rootPath: "(root)",
    recordCount: 1,
  };
}

export function rowsToCsv(rows: FlatRow[], columns: string[]): string {
  const escape = (v: string) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map(escape).join(",");
  const body = rows
    .map((r) => columns.map((c) => escape(r[c] ?? "")).join(","))
    .join("\n");
  return header + "\n" + body;
}
