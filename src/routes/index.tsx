import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  Upload,
  FileCode2,
  FileSpreadsheet,
  Download,
  Trash2,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Package,
  Eye,
  X,
  Activity,
  Archive,
  Combine,
  ChevronRight,
  Sun,
  Moon,
  RefreshCw,
  Sparkles,
  FileJson,
  ArrowUpDown,
  Settings2,
  Link2,
  Copy,
  Keyboard,
  Info,
  FileText,
} from "lucide-react";
import { parseXmlToRows, rowsToCsv, type ParseResult, type FlatRow } from "@/lib/xml-convert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "dev Moseti // XML→CSV Converter" },
      {
        name: "description",
        content:
          "Smart browser-native XML to CSV converter. Drag-and-drop, auto-detect structure, flatten nested elements, batch export to CSV, JSON & ZIP.",
      },
      { property: "og:title", content: "dev Moseti — XML to CSV Converter" },
      {
        property: "og:description",
        content: "Batch convert XML to CSV with structure detection, type inference, preview, and ZIP export.",
      },
    ],
  }),
  component: ConverterPage,
});

type FileStatus = "queued" | "parsing" | "ready" | "error" | "converted";
type SortKey = "added" | "name" | "size" | "status" | "records";
type Theme = "light" | "dark";

interface LogEntry {
  t: number;
  level: "info" | "ok" | "warn" | "err";
  msg: string;
}

interface FileJob {
  id: string;
  name: string;
  size: number;
  status: FileStatus;
  progress: number;
  result?: ParseResult;
  csv?: string;
  error?: string;
  addedAt: number;
  durationMs?: number;
  hash?: string;
}

interface HistoryEntry {
  id: string;
  name: string;
  records: number;
  columns: number;
  bytes: number;
  at: number;
  kind: "csv" | "json" | "zip" | "merge";
}

const FMT = new Intl.NumberFormat();
const HISTORY_KEY = "xml2csv:history";
const THEME_KEY = "xml2csv:theme";
const AUTODL_KEY = "xml2csv:autodl";

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}
function ts(d = new Date()) {
  return d.toTimeString().slice(0, 8);
}

/** Lightweight column type inference for preview intelligence */
type ColType = "int" | "float" | "bool" | "date" | "string";
function inferTypes(rows: FlatRow[], columns: string[]): Record<string, ColType> {
  const out: Record<string, ColType> = {};
  const sample = rows.slice(0, 200);
  for (const c of columns) {
    let ints = 0, floats = 0, bools = 0, dates = 0, nonEmpty = 0;
    for (const r of sample) {
      const v = r[c];
      if (v == null || v === "") continue;
      nonEmpty++;
      const s = String(v).trim();
      if (/^(true|false)$/i.test(s)) { bools++; continue; }
      if (/^-?\d+$/.test(s)) { ints++; continue; }
      if (/^-?\d*\.\d+$/.test(s)) { floats++; continue; }
      if (!isNaN(Date.parse(s)) && /\d{4}/.test(s) && /[-/T:]/.test(s)) { dates++; continue; }
    }
    if (!nonEmpty) { out[c] = "string"; continue; }
    if (bools === nonEmpty) out[c] = "bool";
    else if (ints === nonEmpty) out[c] = "int";
    else if (ints + floats === nonEmpty) out[c] = "float";
    else if (dates === nonEmpty) out[c] = "date";
    else out[c] = "string";
  }
  return out;
}

async function hashString(s: string): Promise<string> {
  try {
    const buf = new TextEncoder().encode(s);
    const h = await crypto.subtle.digest("SHA-1", buf);
    return Array.from(new Uint8Array(h)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return String(s.length);
  }
}

function rowsToJson(rows: FlatRow[]): string {
  return JSON.stringify(rows, null, 2);
}

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book id="b1">
    <title>The Pragmatic Programmer</title>
    <author>Andy Hunt</author>
    <price currency="USD">39.95</price>
    <published>1999-10-30</published>
    <inStock>true</inStock>
  </book>
  <book id="b2">
    <title>Clean Code</title>
    <author>Robert C. Martin</author>
    <price currency="USD">32.50</price>
    <published>2008-08-01</published>
    <inStock>true</inStock>
  </book>
  <book id="b3">
    <title>Designing Data-Intensive Applications</title>
    <author>Martin Kleppmann</author>
    <price currency="USD">45.00</price>
    <published>2017-03-16</published>
    <inStock>false</inStock>
  </book>
</catalog>`;

function ConverterPage() {
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<FileJob | null>(null);
  const [previewSearch, setPreviewSearch] = useState("");
  const [converting, setConverting] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [autoDownload, setAutoDownload] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("added");
  const [sortDesc, setSortDesc] = useState(true);
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // hydration-safe init
  useEffect(() => {
    setLogs([{ t: Date.now(), level: "info", msg: "dev Moseti ready. drop XML files to begin." }]);
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) setHistory(JSON.parse(saved));
      const t = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "dark";
      setTheme(t);
      setAutoDownload(localStorage.getItem(AUTODL_KEY) === "1");
    } catch { /* noop */ }
  }, []);

  // apply theme class
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* noop */ }
  }, [theme]);

  // persist history
  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50))); } catch { /* noop */ }
  }, [history]);

  // autoscroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logs]);

  const log = useCallback((level: LogEntry["level"], msg: string) => {
    setLogs((l) => [...l.slice(-299), { t: Date.now(), level, msg }]);
  }, []);

  const update = useCallback((id: string, patch: Partial<FileJob>) => {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const parseFile = useCallback(
    async (job: FileJob, file: File): Promise<FileJob | null> => {
      const started = performance.now();
      update(job.id, { status: "parsing", progress: 10 });
      log("info", `parse → ${job.name} (${fmtBytes(job.size)})`);

      try {
        const reader = file.stream().getReader();
        const decoder = new TextDecoder("utf-8");
        let xml = "";
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          xml += decoder.decode(value, { stream: true });
          const pct = Math.min(60, 10 + Math.round((received / Math.max(1, file.size)) * 50));
          update(job.id, { progress: pct });
        }
        xml += decoder.decode();
        update(job.id, { progress: 75 });
        await new Promise((r) => setTimeout(r, 0));

        const hash = await hashString(xml);
        const result = parseXmlToRows(xml);
        const csv = rowsToCsv(result.rows, result.columns);
        const duration = Math.round(performance.now() - started);

        const updated: Partial<FileJob> = {
          status: "ready",
          progress: 100,
          result,
          csv,
          durationMs: duration,
          hash,
        };
        update(job.id, updated);
        log(
          "ok",
          `done ← ${job.name}: ${FMT.format(result.recordCount)} rows × ${result.columns.length} cols in ${duration}ms`,
        );
        return { ...job, ...updated } as FileJob;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        update(job.id, { status: "error", progress: 100, error: msg });
        log("err", `fail ✗ ${job.name}: ${msg}`);
        return null;
      }
    },
    [log, update],
  );

  /** Concurrency-limited parallel parser */
  const runParallel = useCallback(
    async (pairs: Array<{ job: FileJob; file: File }>, concurrency = 3) => {
      const queue = [...pairs];
      const completed: FileJob[] = [];
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
          const item = queue.shift();
          if (!item) break;
          const res = await parseFile(item.job, item.file);
          if (res) completed.push(res);
        }
      });
      await Promise.all(workers);
      return completed;
    },
    [parseFile],
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      const xmlFiles = arr.filter(
        (f) => f.name.toLowerCase().endsWith(".xml") || f.type.includes("xml"),
      );
      const rejected = arr.length - xmlFiles.length;
      if (rejected > 0) {
        log("warn", `skipped ${rejected} non-xml file(s)`);
        toast.warning(`${rejected} non-XML file(s) skipped`);
      }
      if (!xmlFiles.length) return;

      const newJobs: FileJob[] = xmlFiles.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        size: f.size,
        status: "queued",
        progress: 0,
        addedAt: Date.now(),
      }));
      setJobs((js) => [...newJobs, ...js]);
      log("info", `queued ${newJobs.length} file(s) · parallel x3`);

      const completed = await runParallel(
        newJobs.map((j, i) => ({ job: j, file: xmlFiles[i] })),
        3,
      );

      if (autoDownload && completed.length) {
        log("info", `auto-download enabled → ${completed.length} files`);
        for (const j of completed) downloadOneSilent(j);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, runParallel, autoDownload],
  );

  const loadSample = useCallback(async () => {
    const file = new File([SAMPLE_XML], "sample-catalog.xml", { type: "application/xml" });
    await addFiles([file]);
    toast.success("Sample XML loaded");
  }, [addFiles]);

  const fetchFromUrl = useCallback(async () => {
    const url = urlValue.trim();
    if (!url) return;
    setUrlLoading(true);
    log("info", `GET ${url}`);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!/<\?xml|<[a-zA-Z]/.test(text.trim().slice(0, 200))) {
        throw new Error("response does not look like XML");
      }
      const name = url.split("/").pop()?.split("?")[0] || `fetched-${Date.now()}.xml`;
      const safe = name.toLowerCase().endsWith(".xml") ? name : `${name}.xml`;
      const file = new File([text], safe, { type: "application/xml" });
      await addFiles([file]);
      toast.success(`Fetched ${safe}`);
      setUrlOpen(false);
      setUrlValue("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("err", `fetch failed: ${msg}`);
      toast.error(`Fetch failed: ${msg}`);
    } finally {
      setUrlLoading(false);
    }
  }, [urlValue, addFiles, log]);


  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  // Paste XML from clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text");
      if (text && /<\?xml|<[a-zA-Z]/.test(text.trim().slice(0, 200))) {
        const file = new File([text], `pasted-${Date.now()}.xml`, { type: "application/xml" });
        addFiles([file]);
        toast.success("Pasted XML queued");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShortcutsOpen((s) => !s);
      } else if (e.key.toLowerCase() === "u" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.click();
      } else if (e.key.toLowerCase() === "l" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setUrlOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const removeJob = (id: string) => {
    setJobs((js) => js.filter((j) => j.id !== id));
    log("info", `removed job ${id.slice(0, 8)}`);
  };

  const clearAll = () => {
    setJobs([]);
    log("warn", "cleared queue");
  };

  const clearCompleted = () => {
    setJobs((js) => js.filter((j) => j.status !== "converted" && j.status !== "ready"));
    log("info", "cleared completed jobs");
  };

  const retryErrors = async () => {
    const errs = jobs.filter((j) => j.status === "error");
    if (!errs.length) {
      toast.info("No errors to retry");
      return;
    }
    log("info", `retry ${errs.length} failed job(s)`);
    toast.info("Re-add the file(s) from disk to retry — original buffer not retained");
  };

  const recordHistory = (entry: HistoryEntry) => {
    setHistory((h) => [entry, ...h].slice(0, 50));
  };

  function triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadOneSilent(j: FileJob) {
    if (!j.csv || !j.result) return;
    const blob = new Blob([j.csv], { type: "text/csv;charset=utf-8" });
    const name = j.name.replace(/\.xml$/i, "") + ".csv";
    triggerDownload(blob, name);
    update(j.id, { status: "converted" });
    recordHistory({
      id: j.id + "-csv-" + Date.now(),
      name,
      records: j.result.recordCount,
      columns: j.result.columns.length,
      bytes: blob.size,
      at: Date.now(),
      kind: "csv",
    });
    log("ok", `↓ ${name} (${fmtBytes(blob.size)})`);
  }

  const downloadOne = (j: FileJob) => downloadOneSilent(j);

  const downloadOneJson = (j: FileJob) => {
    if (!j.result) return;
    const json = rowsToJson(j.result.rows);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const name = j.name.replace(/\.xml$/i, "") + ".json";
    triggerDownload(blob, name);
    recordHistory({
      id: j.id + "-json-" + Date.now(),
      name,
      records: j.result.recordCount,
      columns: j.result.columns.length,
      bytes: blob.size,
      at: Date.now(),
      kind: "json",
    });
    log("ok", `↓ ${name} (${fmtBytes(blob.size)})`);
  };

  const downloadOneTsv = (j: FileJob) => {
    if (!j.result) return;
    const cols = j.result.columns;
    const escTsv = (v: string) =>
      (v ?? "").toString().replace(/\t/g, " ").replace(/\r?\n/g, " ");
    const lines = [cols.map(escTsv).join("\t")];
    for (const r of j.result.rows) lines.push(cols.map((c) => escTsv(r[c] ?? "")).join("\t"));
    const blob = new Blob([lines.join("\n")], { type: "text/tab-separated-values;charset=utf-8" });
    const name = j.name.replace(/\.xml$/i, "") + ".tsv";
    triggerDownload(blob, name);
    recordHistory({
      id: j.id + "-tsv-" + Date.now(),
      name,
      records: j.result.recordCount,
      columns: cols.length,
      bytes: blob.size,
      at: Date.now(),
      kind: "csv",
    });
    log("ok", `↓ ${name} (${fmtBytes(blob.size)})`);
  };

  const copyCsv = async (j: FileJob) => {
    if (!j.csv) return;
    try {
      await navigator.clipboard.writeText(j.csv);
      toast.success(`Copied ${j.name.replace(/\.xml$/i, "")}.csv to clipboard`);
      log("ok", `clipboard ← ${j.name}`);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const downloadCombined = () => {
    const ready = jobs.filter((j) => j.csv && j.result);
    if (!ready.length) { toast.error("Nothing to combine"); return; }
    log("info", `merging ${ready.length} file(s) → single csv`);
    const colSet = new Set<string>(["__source"]);
    for (const j of ready) for (const c of j.result!.columns) colSet.add(c);
    const columns = Array.from(colSet);
    const esc = (v: string) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [columns.map(esc).join(",")];
    let total = 0;
    for (const j of ready) {
      for (const row of j.result!.rows) {
        const merged: Record<string, string> = { __source: j.name, ...row };
        lines.push(columns.map((c) => esc(merged[c] ?? "")).join(","));
        total++;
      }
    }
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const name = `xml2csv-combined-${Date.now()}.csv`;
    triggerDownload(blob, name);
    ready.forEach((j) => update(j.id, { status: "converted" }));
    recordHistory({
      id: crypto.randomUUID(), name, records: total, columns: columns.length,
      bytes: blob.size, at: Date.now(), kind: "merge",
    });
    log("ok", `↓ ${name} — ${FMT.format(total)} rows × ${columns.length} cols (${fmtBytes(blob.size)})`);
    toast.success(`Combined ${ready.length} files → ${FMT.format(total)} rows`);
  };

  const downloadZip = async () => {
    const ready = jobs.filter((j) => j.csv && j.result);
    if (!ready.length) { toast.error("Nothing to export"); return; }
    setConverting(true);
    log("info", `packaging ${ready.length} file(s) → zip`);
    try {
      const zip = new JSZip();
      const folder = zip.folder("xml2csv-export")!;
      for (const j of ready) {
        const base = j.name.replace(/\.xml$/i, "");
        folder.file(base + ".csv", j.csv!);
        folder.file(base + ".json", rowsToJson(j.result!.rows));
      }
      const manifest = ready
        .map((j) =>
          `${j.name} → ${FMT.format(j.result!.recordCount)} rows × ${j.result!.columns.length} cols (${j.durationMs ?? 0}ms) [${j.hash ?? "-"}]`)
        .join("\n");
      folder.file("_manifest.txt", `dev Moseti export\n${new Date().toISOString()}\n\n${manifest}\n`);
      const blob = await zip.generateAsync({ type: "blob" });
      const name = `xml2csv-${Date.now()}.zip`;
      triggerDownload(blob, name);
      ready.forEach((j) => update(j.id, { status: "converted" }));
      recordHistory({
        id: crypto.randomUUID(), name,
        records: ready.reduce((s, j) => s + j.result!.recordCount, 0),
        columns: 0, bytes: blob.size, at: Date.now(), kind: "zip",
      });
      log("ok", `↓ ${name} (${fmtBytes(blob.size)})`);
      toast.success(`Exported ${ready.length} files`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("err", `zip failed: ${msg}`);
      toast.error("ZIP export failed");
    } finally {
      setConverting(false);
    }
  };

  const filtered = useMemo(() => {
    let out = jobs;
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((j) => j.name.toLowerCase().includes(q));
    }
    const dir = sortDesc ? -1 : 1;
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case "name": return a.name.localeCompare(b.name) * dir;
        case "size": return (a.size - b.size) * dir;
        case "status": return a.status.localeCompare(b.status) * dir;
        case "records": return ((a.result?.recordCount ?? 0) - (b.result?.recordCount ?? 0)) * dir;
        default: return (a.addedAt - b.addedAt) * dir;
      }
    });
    return out;
  }, [jobs, search, sortKey, sortDesc]);

  const stats = useMemo(() => {
    const ready = jobs.filter((j) => j.status === "ready" || j.status === "converted");
    const errors = jobs.filter((j) => j.status === "error").length;
    const parsing = jobs.filter((j) => j.status === "parsing").length;
    const records = ready.reduce((sum, j) => sum + (j.result?.recordCount ?? 0), 0);
    const bytes = jobs.reduce((s, j) => s + j.size, 0);
    const durations = ready.map((j) => j.durationMs ?? 0).filter(Boolean);
    const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    return { total: jobs.length, ready: ready.length, errors, parsing, records, bytes, avgMs };
  }, [jobs]);

  const previewTypes = useMemo(() => {
    if (!preview?.result) return {};
    return inferTypes(preview.result.rows, preview.result.columns);
  }, [preview]);

  const previewRows = useMemo(() => {
    if (!preview?.result) return [];
    const rows = preview.result.rows;
    if (!previewSearch.trim()) return rows.slice(0, 100);
    const q = previewSearch.toLowerCase();
    return rows
      .filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)))
      .slice(0, 100);
  }, [preview, previewSearch]);

  return (
    <div className="min-h-screen scanlines">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-md bg-primary/10 border border-primary/30 grid place-items-center text-glow">
              <Terminal className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                <span className="text-primary">dev</span>
                <span className="text-muted-foreground"> Moseti</span>
              </h1>
              <p className="text-[11px] text-muted-foreground">
                xml → csv conversion // intelligent · streaming · browser-native
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground mr-2">
              <Activity className="size-3.5 text-primary" />
              <span className="text-foreground">{FMT.format(stats.records)}</span>
              <span>rec</span>
              <span className="text-border">│</span>
              <span className="text-foreground">{stats.ready}/{stats.total}</span>
              <span>ready</span>
              {stats.avgMs > 0 && (<>
                <span className="text-border">│</span>
                <span className="text-foreground">{stats.avgMs}ms</span>
                <span>avg</span>
              </>)}
              {stats.errors > 0 && (<>
                <span className="text-border">│</span>
                <span className="text-destructive">{stats.errors} err</span>
              </>)}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" title="settings" className="size-9">
                  <Settings2 className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-mono text-xs">settings</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-2 flex items-center justify-between">
                  <Label htmlFor="autodl" className="text-xs font-mono cursor-pointer">auto-download</Label>
                  <Switch
                    id="autodl"
                    checked={autoDownload}
                    onCheckedChange={(v) => {
                      setAutoDownload(v);
                      try { localStorage.setItem(AUTODL_KEY, v ? "1" : "0"); } catch { /* noop */ }
                    }}
                  />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={loadSample} className="font-mono text-xs">
                  <Sparkles className="size-3.5 mr-2 text-primary" /> load sample xml
                </DropdownMenuItem>
                <DropdownMenuItem onClick={retryErrors} className="font-mono text-xs">
                  <RefreshCw className="size-3.5 mr-2" /> retry errors
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShortcutsOpen(true)} className="font-mono text-xs">
                  <Keyboard className="size-3.5 mr-2" /> keyboard shortcuts
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="font-mono text-xs">
                  <Link to="/about"><Info className="size-3.5 mr-2" /> about / features</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setHistory([]); toast.success("History cleared"); }} className="font-mono text-xs">
                  <Trash2 className="size-3.5 mr-2" /> clear history
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button asChild variant="outline" size="icon" className="size-9" title="about">
              <Link to="/about"><Info className="size-4" /></Link>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "switch to light" : "switch to dark"}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* LEFT */}
        <div className="space-y-6 min-w-0">
          {/* Dropzone */}
          <section
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "relative cursor-pointer rounded-lg border border-dashed transition-all",
              "bg-card/40 hover:bg-card/70",
              dragging
                ? "border-primary glow-primary bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".xml,application/xml,text/xml"
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
            <div className="p-10 text-center">
              <div className="inline-flex size-14 items-center justify-center rounded-md bg-primary/10 border border-primary/30 mb-4">
                <Upload className="size-6 text-primary" />
              </div>
              <p className="text-sm">
                <span className="text-primary">$</span> drop xml files here{" "}
                <span className="text-muted-foreground">or click to browse · ⌘V to paste</span>
                <span className="cursor-blink" />
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                bulk upload · auto-detect · parallel parse · type inference · streaming · press <span className="text-primary">?</span> for shortcuts
              </p>
            </div>
          </section>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="grep filename..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card/60 border-border font-mono text-sm h-9"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <ArrowUpDown className="size-4" /> sort: {sortKey}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(["added", "name", "size", "status", "records"] as SortKey[]).map((k) => (
                  <DropdownMenuItem key={k} onClick={() => setSortKey(k)} className="font-mono text-xs">
                    {k === sortKey ? "✓ " : "  "}{k}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={sortDesc} onCheckedChange={setSortDesc} className="font-mono text-xs">
                  descending
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="default" size="sm" onClick={downloadZip}
              disabled={converting || stats.ready === 0} className="gap-2">
              {converting ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
              export zip ({stats.ready})
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadCombined}
              disabled={stats.ready === 0} className="gap-2">
              <Combine className="size-4" /> merge csv ({stats.ready})
            </Button>
            <Button variant="outline" size="sm" onClick={clearCompleted}
              disabled={stats.ready === 0} className="gap-2">
              clear done
            </Button>
            <Button variant="outline" size="sm" onClick={clearAll}
              disabled={jobs.length === 0} className="gap-2">
              <Trash2 className="size-4" /> clear all
            </Button>
          </div>

          {/* Job list */}
          <section className="rounded-lg border border-border bg-card/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-card/60 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                <ChevronRight className="size-3 inline text-primary" /> files
                <span className="ml-2 text-foreground">{filtered.length}</span>
                {stats.parsing > 0 && <span className="ml-2 text-accent">· {stats.parsing} parsing</span>}
              </span>
              <span>{fmtBytes(stats.bytes)} total</span>
            </div>

            {filtered.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                <FileCode2 className="size-8 mx-auto mb-2 opacity-40" />
                {jobs.length === 0 ? (
                  <div className="space-y-3">
                    <div>no files queued</div>
                    <Button variant="outline" size="sm" onClick={loadSample} className="gap-2">
                      <Sparkles className="size-3.5 text-primary" /> load sample
                    </Button>
                  </div>
                ) : "no matches"}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    onPreview={() => { setPreviewSearch(""); setPreview(j); }}
                    onDownload={() => downloadOne(j)}
                    onDownloadJson={() => downloadOneJson(j)}
                    onRemove={() => removeJob(j.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* RIGHT */}
        <aside className="space-y-6">
          {/* Logs */}
          <section className="rounded-lg border border-border bg-terminal overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-card/60">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-destructive/70" />
                <span className="size-2.5 rounded-full bg-accent/70" />
                <span className="size-2.5 rounded-full bg-primary/70" />
              </div>
              <span className="text-xs text-muted-foreground ml-2">~/conversion.log</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{logs.length}</span>
            </div>
            <div className="p-3 h-[280px] overflow-auto text-[11.5px] leading-relaxed font-mono">
              {logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground/60 shrink-0">{ts(new Date(l.t))}</span>
                  <span className={cn("shrink-0",
                    l.level === "ok" && "text-primary",
                    l.level === "warn" && "text-accent",
                    l.level === "err" && "text-destructive",
                    l.level === "info" && "text-muted-foreground",
                  )}>
                    [{l.level}]
                  </span>
                  <span className="text-terminal-foreground/90 break-all">{l.msg}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </section>

          {/* History */}
          <section className="rounded-lg border border-border bg-card/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-card/60 text-xs text-muted-foreground flex items-center justify-between">
              <span>
                <ChevronRight className="size-3 inline text-primary" /> history
              </span>
              <span className="text-foreground">{history.length}</span>
            </div>
            <div className="max-h-[280px] overflow-auto">
              {history.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">no downloads yet</div>
              ) : (
                <ul className="divide-y divide-border">
                  {history.map((h) => (
                    <li key={h.id} className="px-4 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-foreground flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[9px] font-mono px-1 py-0">{h.kind}</Badge>
                          {h.name}
                        </span>
                        <span className="text-muted-foreground shrink-0">{ts(new Date(h.at))}</span>
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {FMT.format(h.records)} rows{h.columns ? ` · ${h.columns} cols` : ""} · {fmtBytes(h.bytes)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </main>

      {/* Preview Dialog */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-mono">
              <FileSpreadsheet className="size-4 text-primary" />
              {preview?.name}
              {preview?.result && (
                <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                  {FMT.format(preview.result.recordCount)} × {preview.result.columns.length}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {preview?.result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                <span className="text-muted-foreground">
                  root: <span className="text-primary">{preview.result.rootPath || "(root)"}</span>
                </span>
                {preview.durationMs != null && (
                  <span className="text-muted-foreground">parsed in <span className="text-foreground">{preview.durationMs}ms</span></span>
                )}
                <div className="relative ml-auto">
                  <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="filter rows..."
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    className="pl-8 h-8 w-48 font-mono text-xs"
                  />
                </div>
              </div>
              <div className="rounded-md border border-border overflow-auto max-h-[60vh]">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-card/80 sticky top-0">
                    <tr>
                      {preview.result.columns.slice(0, 20).map((c) => (
                        <th key={c} className="text-left px-3 py-2 border-b border-border whitespace-nowrap">
                          <div className="text-primary font-medium">{c}</div>
                          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
                            {previewTypes[c] ?? "string"}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        {preview.result!.columns.slice(0, 20).map((c) => (
                          <td key={c}
                            className="px-3 py-1.5 border-b border-border/50 whitespace-nowrap max-w-[240px] truncate text-foreground/90">
                            {row[c] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  showing {previewRows.length} of {FMT.format(preview.result.recordCount)} rows ·{" "}
                  {Math.min(20, preview.result.columns.length)}/{preview.result.columns.length} cols
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => downloadOneJson(preview)} className="gap-2">
                    <FileJson className="size-3.5" /> json
                  </Button>
                  <Button size="sm" onClick={() => downloadOne(preview)} className="gap-2">
                    <Download className="size-3.5" /> csv
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JobRow({
  job, onPreview, onDownload, onDownloadJson, onRemove,
}: {
  job: FileJob;
  onPreview: () => void;
  onDownload: () => void;
  onDownloadJson: () => void;
  onRemove: () => void;
}) {
  const statusColor = {
    queued: "text-muted-foreground",
    parsing: "text-accent",
    ready: "text-primary",
    converted: "text-primary",
    error: "text-destructive",
  }[job.status];

  const Icon = {
    queued: Package,
    parsing: Loader2,
    ready: CheckCircle2,
    converted: CheckCircle2,
    error: AlertCircle,
  }[job.status];

  return (
    <li className="px-4 py-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <Icon className={cn("size-4 shrink-0", statusColor, job.status === "parsing" && "animate-spin")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm truncate font-mono">{job.name}</span>
            <span className="text-[11px] text-muted-foreground shrink-0">{fmtBytes(job.size)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={job.progress} className="h-1 flex-1" />
            <span className={cn("text-[10px] font-mono uppercase tracking-wider", statusColor)}>
              {job.status}
            </span>
          </div>
          {job.result && (
            <div className="mt-1 text-[11px] text-muted-foreground font-mono">
              {FMT.format(job.result.recordCount)} rows × {job.result.columns.length} cols
              {job.durationMs != null && ` · ${job.durationMs}ms`} · root{" "}
              <span className="text-primary/80">{job.result.rootPath || "(root)"}</span>
              {job.hash && <span className="ml-1 opacity-60">#{job.hash}</span>}
            </div>
          )}
          {job.error && (
            <div className="mt-1 text-[11px] text-destructive font-mono break-all">✗ {job.error}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {job.result && (
            <>
              <Button size="icon" variant="ghost" onClick={onPreview} title="preview">
                <Eye className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onDownloadJson} title="download json">
                <FileJson className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onDownload} title="download csv">
                <Download className="size-4" />
              </Button>
            </>
          )}
          <Button size="icon" variant="ghost" onClick={onRemove} title="remove">
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}
