import { createFileRoute } from "@tanstack/react-router";
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
  ChevronRight,
} from "lucide-react";
import { parseXmlToRows, rowsToCsv, type ParseResult } from "@/lib/xml-convert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "xml2csv // Enterprise XML→CSV Converter" },
      {
        name: "description",
        content:
          "Drag-and-drop XML to CSV converter. Auto-detect structure, flatten nested elements, batch export to CSV and ZIP. Streaming, fast, browser-native.",
      },
      { property: "og:title", content: "xml2csv — Enterprise XML to CSV Converter" },
      {
        property: "og:description",
        content: "Batch convert XML files to CSV with structure detection, preview, and ZIP export.",
      },
    ],
  }),
  component: ConverterPage,
});

type FileStatus = "queued" | "parsing" | "ready" | "error" | "converted";

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
}

interface HistoryEntry {
  id: string;
  name: string;
  records: number;
  columns: number;
  bytes: number;
  at: number;
}

const FMT = new Intl.NumberFormat();
function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}
function ts(d = new Date()) {
  return d.toTimeString().slice(0, 8);
}

function ConverterPage() {
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { t: Date.now(), level: "info", msg: "xml2csv ready. drop XML files to begin." },
  ]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<FileJob | null>(null);
  const [converting, setConverting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const log = useCallback((level: LogEntry["level"], msg: string) => {
    setLogs((l) => [...l.slice(-199), { t: Date.now(), level, msg }]);
  }, []);

  const update = useCallback((id: string, patch: Partial<FileJob>) => {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const parseFile = useCallback(
    async (job: FileJob, file: File) => {
      const started = performance.now();
      update(job.id, { status: "parsing", progress: 10 });
      log("info", `parse → ${job.name} (${fmtBytes(job.size)})`);

      try {
        // Stream-read the file in chunks for progress reporting on large files
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

        update(job.id, { progress: 70 });
        // Yield to keep UI responsive
        await new Promise((r) => setTimeout(r, 0));

        const result = parseXmlToRows(xml);
        const csv = rowsToCsv(result.rows, result.columns);
        const duration = Math.round(performance.now() - started);

        update(job.id, {
          status: "ready",
          progress: 100,
          result,
          csv,
          durationMs: duration,
        });
        log(
          "ok",
          `done ← ${job.name}: ${FMT.format(result.recordCount)} rows × ${result.columns.length} cols in ${duration}ms`,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        update(job.id, { status: "error", progress: 100, error: msg });
        log("err", `fail ✗ ${job.name}: ${msg}`);
      }
    },
    [log, update],
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
      log("info", `queued ${newJobs.length} file(s)`);

      // Parse sequentially to avoid hammering the main thread
      for (let i = 0; i < newJobs.length; i++) {
        await parseFile(newJobs[i], xmlFiles[i]);
      }
    },
    [log, parseFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeJob = (id: string) => {
    setJobs((js) => js.filter((j) => j.id !== id));
    log("info", `removed job ${id.slice(0, 8)}`);
  };

  const clearAll = () => {
    setJobs([]);
    log("warn", "cleared queue");
  };

  const downloadOne = (j: FileJob) => {
    if (!j.csv || !j.result) return;
    const blob = new Blob([j.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = j.name.replace(/\.xml$/i, "") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
    update(j.id, { status: "converted" });
    setHistory((h) => [
      {
        id: j.id,
        name: a.download,
        records: j.result!.recordCount,
        columns: j.result!.columns.length,
        bytes: blob.size,
        at: Date.now(),
      },
      ...h,
    ].slice(0, 50));
    log("ok", `↓ ${a.download} (${fmtBytes(blob.size)})`);
  };

  const downloadZip = async () => {
    const ready = jobs.filter((j) => j.csv && j.result);
    if (!ready.length) {
      toast.error("Nothing to export");
      return;
    }
    setConverting(true);
    log("info", `packaging ${ready.length} file(s) → zip`);
    try {
      const zip = new JSZip();
      const folder = zip.folder("xml2csv-export")!;
      for (const j of ready) {
        folder.file(j.name.replace(/\.xml$/i, "") + ".csv", j.csv!);
      }
      // Manifest
      const manifest = ready
        .map(
          (j) =>
            `${j.name} → ${FMT.format(j.result!.recordCount)} rows × ${j.result!.columns.length} cols (${j.durationMs ?? 0}ms)`,
        )
        .join("\n");
      folder.file("_manifest.txt", `xml2csv export\n${new Date().toISOString()}\n\n${manifest}\n`);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `xml2csv-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      ready.forEach((j) => update(j.id, { status: "converted" }));
      log("ok", `↓ ${a.download} (${fmtBytes(blob.size)})`);
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
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter((j) => j.name.toLowerCase().includes(q));
  }, [jobs, search]);

  const stats = useMemo(() => {
    const ready = jobs.filter((j) => j.status === "ready" || j.status === "converted");
    const errors = jobs.filter((j) => j.status === "error").length;
    const records = ready.reduce((sum, j) => sum + (j.result?.recordCount ?? 0), 0);
    const bytes = jobs.reduce((s, j) => s + j.size, 0);
    return { total: jobs.length, ready: ready.length, errors, records, bytes };
  }, [jobs]);

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
                <span className="text-primary">xml2csv</span>
                <span className="text-muted-foreground">.sh</span>
              </h1>
              <p className="text-[11px] text-muted-foreground">
                enterprise xml → csv conversion // browser-native streaming
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="size-3.5 text-primary" />
            <span>session</span>
            <span className="text-foreground">{FMT.format(stats.records)}</span>
            <span>records</span>
            <span className="text-border">│</span>
            <span className="text-foreground">{stats.ready}/{stats.total}</span>
            <span>ready</span>
            {stats.errors > 0 && (
              <>
                <span className="text-border">│</span>
                <span className="text-destructive">{stats.errors} errors</span>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* LEFT */}
        <div className="space-y-6 min-w-0">
          {/* Dropzone */}
          <section
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
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
                <span className="text-muted-foreground">or click to browse</span>
                <span className="cursor-blink" />
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                multi-file · auto-detect structure · streaming read · nested flattening
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
            <Button
              variant="default"
              size="sm"
              onClick={downloadZip}
              disabled={converting || stats.ready === 0}
              className="gap-2"
            >
              {converting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Archive className="size-4" />
              )}
              export zip ({stats.ready})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              disabled={jobs.length === 0}
              className="gap-2"
            >
              <Trash2 className="size-4" />
              clear
            </Button>
          </div>

          {/* Job list */}
          <section className="rounded-lg border border-border bg-card/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-card/60 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                <ChevronRight className="size-3 inline text-primary" /> files
                <span className="ml-2 text-foreground">{filtered.length}</span>
              </span>
              <span>{fmtBytes(stats.bytes)} total</span>
            </div>

            {filtered.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                <FileCode2 className="size-8 mx-auto mb-2 opacity-40" />
                {jobs.length === 0 ? "no files queued" : "no matches"}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    onPreview={() => setPreview(j)}
                    onDownload={() => downloadOne(j)}
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
            </div>
            <div className="p-3 h-[280px] overflow-auto text-[11.5px] leading-relaxed font-mono">
              {logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground/60 shrink-0">{ts(new Date(l.t))}</span>
                  <span
                    className={cn(
                      "shrink-0",
                      l.level === "ok" && "text-primary",
                      l.level === "warn" && "text-accent",
                      l.level === "err" && "text-destructive",
                      l.level === "info" && "text-muted-foreground",
                    )}
                  >
                    [{l.level}]
                  </span>
                  <span className="text-terminal-foreground/90 break-all">{l.msg}</span>
                </div>
              ))}
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
                <div className="p-6 text-center text-xs text-muted-foreground">
                  no downloads yet
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {history.map((h) => (
                    <li key={h.id + h.at} className="px-4 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-foreground">{h.name}</span>
                        <span className="text-muted-foreground shrink-0">
                          {ts(new Date(h.at))}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {FMT.format(h.records)} rows · {h.columns} cols · {fmtBytes(h.bytes)}
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
              <div className="text-xs text-muted-foreground font-mono">
                root: <span className="text-primary">{preview.result.rootPath || "(root)"}</span>
              </div>
              <div className="rounded-md border border-border overflow-auto max-h-[60vh]">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-card/80 sticky top-0">
                    <tr>
                      {preview.result.columns.slice(0, 20).map((c) => (
                        <th
                          key={c}
                          className="text-left px-3 py-2 border-b border-border text-primary font-medium whitespace-nowrap"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.result.rows.slice(0, 100).map((row, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        {preview.result!.columns.slice(0, 20).map((c) => (
                          <td
                            key={c}
                            className="px-3 py-1.5 border-b border-border/50 whitespace-nowrap max-w-[240px] truncate text-foreground/90"
                          >
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
                  showing first {Math.min(100, preview.result.rows.length)} of{" "}
                  {FMT.format(preview.result.recordCount)} rows ·{" "}
                  {Math.min(20, preview.result.columns.length)}/{preview.result.columns.length} cols
                </span>
                <Button size="sm" onClick={() => downloadOne(preview)} className="gap-2">
                  <Download className="size-3.5" /> download csv
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JobRow({
  job,
  onPreview,
  onDownload,
  onRemove,
}: {
  job: FileJob;
  onPreview: () => void;
  onDownload: () => void;
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
        <Icon
          className={cn("size-4 shrink-0", statusColor, job.status === "parsing" && "animate-spin")}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm truncate font-mono">{job.name}</span>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {fmtBytes(job.size)}
            </span>
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
            </div>
          )}
          {job.error && (
            <div className="mt-1 text-[11px] text-destructive font-mono break-all">
              ✗ {job.error}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {job.result && (
            <>
              <Button size="icon" variant="ghost" onClick={onPreview} title="preview">
                <Eye className="size-4" />
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
