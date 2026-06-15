import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Terminal,
  ArrowLeft,
  Upload,
  Combine,
  Archive,
  FileJson,
  FileSpreadsheet,
  Eye,
  Search,
  Sun,
  Activity,
  Sparkles,
  Keyboard,
  Link2,
  Copy,
  Zap,
  Shield,
  Cpu,
  Layers,
  Database,
  Clock,
  RefreshCw,
  ArrowUpDown,
  Settings2,
  History,
} from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About // dev Moseti — XML to CSV Converter" },
      {
        name: "description",
        content:
          "About dev Moseti: a fast, private, browser-native XML→CSV converter with bulk upload, merge, ZIP export, JSON/TSV output, type inference and live preview.",
      },
      { property: "og:title", content: "About dev Moseti" },
      {
        property: "og:description",
        content:
          "Learn what dev Moseti can do — every feature of the smart browser-native XML to CSV converter.",
      },
    ],
  }),
  component: AboutPage,
});

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}

const CORE: Feature[] = [
  { icon: Upload, title: "Bulk upload", desc: "Drop dozens of XML files at once — drag-and-drop, click-to-browse, or paste raw XML from clipboard." },
  { icon: Cpu, title: "Parallel parsing", desc: "Files are parsed concurrently (x3) using streaming readers so large XMLs don't freeze the UI." },
  { icon: Layers, title: "Smart structure detection", desc: "Auto-locates the deepest repeating element as records, flattens nested objects/attributes into columns." },
  { icon: Database, title: "Type inference", desc: "Detects int, float, bool, date and string columns from a sample of rows for clearer previews." },
  { icon: Eye, title: "Live preview", desc: "Tabular preview of the first 100 rows with column types, in-row search and root-path indicator." },
];

const EXPORT: Feature[] = [
  { icon: FileSpreadsheet, title: "CSV export", desc: "RFC-4180-style CSV with proper escaping of quotes, commas and newlines." },
  { icon: FileJson, title: "JSON export", desc: "Pretty-printed JSON array of all parsed rows for each file." },
  { icon: Combine, title: "Merge to one CSV", desc: "Combine every parsed file into a single CSV with a __source column and union of all columns." },
  { icon: Archive, title: "ZIP bundle", desc: "Package every CSV + JSON + a manifest (rows, cols, duration, hash) into one .zip download." },
  { icon: Copy, title: "Copy to clipboard", desc: "Copy any file's CSV directly to your clipboard from the preview dialog." },
];

const PRODUCTIVITY: Feature[] = [
  { icon: Link2, title: "Fetch from URL", desc: "Paste a URL to an XML feed and the system fetches and queues it like any uploaded file." },
  { icon: Sparkles, title: "Sample dataset", desc: "Load a built-in sample catalog to try the system in one click." },
  { icon: Search, title: "Filename grep", desc: "Filter the job list with a live search box." },
  { icon: ArrowUpDown, title: "Sort jobs", desc: "Sort by added time, name, size, status or record count — ascending or descending." },
  { icon: RefreshCw, title: "Retry & cleanup", desc: "Retry failed jobs, clear completed, or clear the whole queue with one click." },
  { icon: History, title: "Download history", desc: "Last 50 downloads stored locally with name, kind, rows, columns and bytes." },
  { icon: Activity, title: "Live stats", desc: "Header shows running totals: records, ready/total jobs, average parse time and error count." },
  { icon: Terminal, title: "Conversion log", desc: "Color-coded streaming log with timestamps for every parse, download and error." },
  { icon: Keyboard, title: "Keyboard shortcuts", desc: "⌘V to paste XML, Esc to close dialogs, ? to show the shortcut sheet." },
];

const PLATFORM: Feature[] = [
  { icon: Sun, title: "Light & dark themes", desc: "Toggle themes from the header. Your choice is persisted across sessions." },
  { icon: Shield, title: "100% private", desc: "All parsing and conversion happens in your browser. No file ever leaves your device." },
  { icon: Zap, title: "Zero install", desc: "Pure browser app — no plugins, no desktop software, no account required." },
  { icon: Clock, title: "Auto-download", desc: "Optional: instantly download the CSV as soon as a file finishes parsing." },
  { icon: Settings2, title: "Persistent settings", desc: "Theme, auto-download and history are saved in localStorage." },
];

function Section({ title, items }: { title: string; items: Feature[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-mono uppercase tracking-widest text-primary">
        <span className="text-muted-foreground">##</span> {title}
      </h2>
      <ul className="grid sm:grid-cols-2 gap-3">
        {items.map((f) => (
          <li
            key={f.title}
            className="rounded-md border border-border bg-card/40 p-4 hover:bg-card/70 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="size-8 shrink-0 rounded-md bg-primary/10 border border-primary/30 grid place-items-center">
                <f.icon className="size-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight">{f.title}</div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{f.desc}</div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AboutPage() {
  return (
    <div className="min-h-screen scanlines">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[1100px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-md bg-primary/10 border border-primary/30 grid place-items-center text-glow">
              <Terminal className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                <span className="text-primary">dev</span>
                <span className="text-muted-foreground"> Moseti</span>
                <span className="text-muted-foreground/60"> / about</span>
              </h1>
              <p className="text-[11px] text-muted-foreground">what the system is, and everything it can do</p>
            </div>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-mono px-3 py-2 rounded-md border border-border bg-card/60 hover:bg-card hover:border-primary/50 transition-colors"
          >
            <ArrowLeft className="size-3.5" /> back to converter
          </Link>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 py-10 space-y-10">
        {/* Hero / About */}
        <section className="space-y-4">
          <div className="text-xs font-mono text-primary">
            <span className="text-muted-foreground">$</span> cat ABOUT.md
            <span className="cursor-blink" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
            A smart, browser-native <span className="text-primary">XML → CSV</span> converter.
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
            <span className="text-foreground font-semibold">dev Moseti</span> is a private, zero-install conversion
            studio for turning messy XML feeds into clean tabular data. Drop in one file or a hundred — the system
            streams them in parallel, auto-detects the repeating record structure, flattens nested elements and
            attributes into columns, infers types, and lets you preview, search and export as
            <span className="text-foreground"> CSV</span>,<span className="text-foreground"> JSON</span>,
            <span className="text-foreground"> TSV</span>, a merged single CSV, or a packaged ZIP — all without ever
            uploading your data to a server.
          </p>
          <div className="flex flex-wrap gap-2 text-[11px] font-mono">
            {["browser-native", "private by design", "parallel x3", "streaming", "type-inferred", "light & dark"].map(
              (t) => (
                <span
                  key={t}
                  className="px-2 py-1 rounded border border-border bg-card/60 text-muted-foreground"
                >
                  {t}
                </span>
              ),
            )}
          </div>
        </section>

        <Section title="core conversion" items={CORE} />
        <Section title="export formats" items={EXPORT} />
        <Section title="productivity" items={PRODUCTIVITY} />
        <Section title="platform" items={PLATFORM} />

        {/* What it can do */}
        <section className="space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-primary">
            <span className="text-muted-foreground">##</span> what the system can do
          </h2>
          <div className="rounded-md border border-border bg-card/40 p-5 text-sm leading-relaxed space-y-2 text-muted-foreground">
            <p>
              <span className="text-foreground">→</span> Convert any well-formed XML file (RSS, sitemaps, product
              feeds, banking exports, API responses, OOXML fragments) into structured CSV in seconds.
            </p>
            <p>
              <span className="text-foreground">→</span> Batch-process entire folders of XMLs and download each result
              individually, all together as a ZIP, or merged into a single combined CSV.
            </p>
            <p>
              <span className="text-foreground">→</span> Fetch XML directly from a public URL — useful for sitemaps,
              RSS feeds and open data endpoints.
            </p>
            <p>
              <span className="text-foreground">→</span> Inspect parsed data in a fast tabular preview with column
              types and row-level search before downloading.
            </p>
            <p>
              <span className="text-foreground">→</span> Operate in light or dark mode, with persistent settings and a
              live conversion log so you always know what's happening.
            </p>
          </div>
        </section>

        <footer className="pt-6 border-t border-border text-[11px] font-mono text-muted-foreground flex items-center justify-between">
          <span>dev Moseti // v1.0</span>
          <Link to="/" className="text-primary hover:underline">launch converter →</Link>
        </footer>
      </main>
    </div>
  );
}
