"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { InventoryEditor, WallBoundaryEditor } from "./PhotoEditors";
import { isValidWallBoundary, mapWallPoint, type PhotoFailureCategory } from "@/lib/photoWorkflow";
import {
  GRADES,
  REQUIRED_MOVES,
  STYLES,
  WALL_HOLD_ID,
  type Brief,
  type DetectedHold,
  type GenerateResponse,
  type Placement,
  type PlacementRole,
  type Point,
  type WallBoundary,
  type ValidatedCandidate,
} from "@/lib/schema";
import { SAMPLE_HOLDS as SAMPLE_HOLD_INVENTORY } from "@/lib/sampleGenerator";

const SAMPLE_WALL = "/sample-wall.svg";
const SAMPLE_HOLDS = "/sample-holds.svg";
const VIRTUAL_WALL = "/virtual-wall.svg";

const DEFAULT_BRIEF: Brief = {
  wallWidthM: 3.5,
  wallHeightM: 4,
  wallAngleDeg: 20,
  grade: "V4",
  style: "technical",
  requiredMove: "heel hook",
  climberHeightCm: 170,
  notes: "",
};

const ROLE_STYLE: Record<PlacementRole, { bg: string; ring: string; label: string }> = {
  start: { bg: "#22c55e", ring: "#bbf7d0", label: "Start" },
  hand: { bg: "#0ea5e9", ring: "#e0f2fe", label: "Hand" },
  foot: { bg: "#eab308", ring: "#fef9c3", label: "Foot" },
  finish: { bg: "#f43f5e", ring: "#ffe4e6", label: "Finish" },
};

// ---------- Image helpers ----------

async function fileToDataUrl(file: File, maxDim = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () =>
        reject(new Error("Couldn't read that image. Try a JPEG or PNG (iPhone HEIC photos don't open in Chrome)."));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser couldn't process the image.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Small UI pieces ----------

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="block">
      <span className="mb-1 flex items-baseline justify-between text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
        {hint && <span className="normal-case tracking-normal text-zinc-500">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20";

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      className={inputCls}
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function UploadCard({
  label,
  hint,
  value,
  sampleSrc,
  onFile,
  onClear,
}: {
  label: string;
  hint: string;
  value: string | null;
  sampleSrc: string;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            value ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-400"
          }`}
        >
          {value ? "Uploaded" : "Sample"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`group relative block aspect-[4/3] w-full overflow-hidden rounded-xl border bg-zinc-900 transition ${
          dragging ? "border-emerald-400" : "border-zinc-700 hover:border-zinc-500"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value ?? sampleSrc} alt={label} className="h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-medium text-white opacity-0 transition group-hover:opacity-100">
          Click or drop to upload
        </span>
      </button>
      <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
        <span>{hint}</span>
        {value && (
          <button type="button" onClick={onClear} className="text-zinc-400 underline-offset-2 hover:underline">
            Remove photo
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Marker({
  p,
  highlighted,
  hold,
  onHover,
}: {
  p: Placement;
  highlighted: boolean;
  hold?: DetectedHold;
  onHover: (id: string | null) => void;
}) {
  const s = ROLE_STYLE[p.role];
  const size = p.role === "foot" ? 24 : 32;
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(p.holdId)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(p.holdId)}
      onBlur={() => onHover(null)}
      title={`#${p.sequenceNumber} · ${p.holdId}${hold ? ` (${hold.apparentType}, ${hold.relativeSize})` : ""} · ${s.label} · ${p.rotationDegrees}°`}
      className="absolute transition-transform duration-150"
      style={{
        left: `${p.xPercent}%`,
        top: `${p.yPercent}%`,
        transform: `translate(-50%, -50%) scale(${highlighted ? 1.3 : 1})`,
        zIndex: highlighted ? 20 : 10,
      }}
    >
      <span
        className={`relative flex items-center justify-center font-bold text-white shadow-lg shadow-black/50 ${
          p.role === "foot" ? "rounded-md text-[11px]" : "rounded-full text-xs"
        }`}
        style={{
          width: size,
          height: size,
          backgroundColor: s.bg,
          border: `2px solid ${s.ring}`,
          boxShadow: highlighted ? `0 0 0 4px ${s.bg}66` : undefined,
        }}
      >
        {p.sequenceNumber}
        {p.role !== "foot" && (
          <span
            className="pointer-events-none absolute inset-[-7px]"
            style={{ transform: `rotate(${p.rotationDegrees}deg)` }}
          >
            <span
              className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2"
              style={{ borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: `6px solid ${s.ring}` }}
            />
          </span>
        )}
      </span>
    </button>
  );
}

function WallView({
  src,
  virtualDimensions,
  boundary,
  candidate,
  holds,
  highlight,
  onHover,
  loading,
}: {
  src: string;
  virtualDimensions?: { width: number; height: number };
  boundary?: WallBoundary;
  candidate: ValidatedCandidate | null;
  holds: Map<string, DetectedHold>;
  highlight: string | null;
  onHover: (id: string | null) => void;
  loading: boolean;
}) {
  const displayedPlacements = useMemo(() => {
    if (!candidate) return [];
    return candidate.placements.map((p) => boundary ? { ...p, ...mapWallPoint(p, boundary) } : p);
  }, [candidate, boundary]);
  const handPath = useMemo(() => {
    if (!candidate) return "";
    return displayedPlacements
      .filter((p) => p.role !== "foot")
      .map((p) => `${p.xPercent},${p.yPercent}`)
      .join(" ");
  }, [candidate, displayedPlacements]);

  return (
    <div className="relative mx-auto w-full max-w-[640px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/40"
      style={virtualDimensions ? { aspectRatio: `${virtualDimensions.width} / ${virtualDimensions.height}` } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Wall" className={virtualDimensions ? "absolute inset-0 h-full w-full select-none" : "block h-auto w-full select-none"} draggable={false} />
      {candidate && (
        <>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {boundary && <polygon points={boundary.map((p) => `${p.xPercent},${p.yPercent}`).join(" ")}
              fill="none" stroke="rgba(52,211,153,0.9)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
            <polyline
              points={handPath}
              fill="none"
              stroke="rgba(255,255,255,0.75)"
              strokeWidth={2}
              strokeDasharray="6 5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {displayedPlacements.map((p) => (
            <Marker
              key={`${p.holdId}-${p.sequenceNumber}`}
              p={p}
              hold={holds.get(p.holdId)}
              highlighted={highlight === p.holdId}
              onHover={onHover}
            />
          ))}
        </>
      )}
      {!candidate && !loading && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5 text-center text-sm text-zinc-300">
          Set your brief and hit <span className="font-semibold text-white">Generate routes</span> to see placements.
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/70 backdrop-blur-sm">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-400/30 border-t-emerald-400" />
          <span className="text-sm text-zinc-200">Generating route concepts…</span>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

const STATUS_BADGE: Record<ValidatedCandidate["validation"]["status"], string> = {
  ok: "bg-emerald-500/15 text-emerald-300",
  repaired: "bg-amber-500/15 text-amber-300",
  invalid: "bg-rose-500/15 text-rose-300",
};

type UiError = { message: string; category?: PhotoFailureCategory };
const FAILURE_LABEL: Record<PhotoFailureCategory, string> = {
  image_processing: "Image processing",
  api_request: "API request",
  response_schema: "Response schema",
  route_validation: "Route validation",
};

// ---------- Main app ----------

export default function SetBetaApp() {
  const [brief, setBrief] = useState<Brief>(DEFAULT_BRIEF);
  const [wallImage, setWallImage] = useState<string | null>(null);
  const [holdsImage, setHoldsImage] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<"virtual" | "photo">("virtual");
  const [forceSample, setForceSample] = useState(false);
  const [status, setStatus] = useState<{ aiAvailable: boolean; model: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzingHolds, setAnalyzingHolds] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [photoInventory, setPhotoInventory] = useState<DetectedHold[]>([]);
  const [photoBoundary, setPhotoBoundary] = useState<Point[]>([]);
  const [photoStep, setPhotoStep] = useState<"inventory" | "boundary" | "results">("inventory");
  const [selected, setSelected] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const inputRevision = useRef(0);

  useEffect(() => {
    fetch("/api/generate")
      .then((r) => r.json())
      .then((d: { aiAvailable: boolean; model: string | null }) => setStatus(d))
      .catch(() => setStatus({ aiAvailable: false, model: null }));
  }, []);

  const clearOldResult = () => {
    inputRevision.current += 1;
    setResult(null);
    setSelected(0);
    setHighlight(null);
    setError(null);
    if (workflow === "photo" && photoStep === "results") setPhotoStep("boundary");
  };

  const update = <K extends keyof Brief>(key: K, value: Brief[K]) => {
    clearOldResult();
    setBrief((b) => ({ ...b, [key]: value }));
  };

  const handleFile = async (file: File, kind: "wall" | "holds") => {
    clearOldResult();
    if (kind === "holds") {
      setPhotoInventory([]);
      setPhotoStep("inventory");
    } else {
      setPhotoBoundary([]);
      setPhotoStep(photoInventory.length >= 5 && photoStep !== "inventory" ? "boundary" : "inventory");
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      if (kind === "holds") setHoldsImage(dataUrl);
      else setWallImage(dataUrl);
    } catch {
      setError({ message: "The photo could not be processed. Try a smaller JPEG or PNG image.", category: "image_processing" });
    }
  };

  const analyzeHolds = async () => {
    if (!holdsImage) return;
    const revision = inputRevision.current;
    setAnalyzingHolds(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze-holds", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ holdsImage }),
      });
      const data = await res.json().catch(() => null) as { detectedHolds?: DetectedHold[]; error?: string; category?: PhotoFailureCategory } | null;
      if (!res.ok || !data?.detectedHolds) {
        if (inputRevision.current === revision) setError({ message: data?.error ?? "Hold analysis failed.", category: data?.category ?? "api_request" });
        return;
      }
      if (inputRevision.current === revision) {
        setPhotoInventory(data.detectedHolds);
        setPhotoStep("inventory");
      }
    } catch {
      if (inputRevision.current === revision) setError({ message: "The AI request could not be completed.", category: "api_request" });
    } finally { setAnalyzingHolds(false); }
  };

  const generate = async (viewSample = false) => {
    const revision = inputRevision.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, workflow,
          inventory: workflow === "virtual" ? SAMPLE_HOLD_INVENTORY : viewSample ? undefined : photoInventory,
          wallImage: workflow === "photo" && !viewSample ? wallImage : null,
          wallBoundary: workflow === "photo" && !viewSample ? photoBoundary : undefined,
          forceSample: workflow === "virtual" ? forceSample : viewSample }),
      });
      const data = (await res.json().catch(() => null)) as (GenerateResponse & { error?: string; category?: PhotoFailureCategory }) | null;
      if (!res.ok || !data) {
        if (inputRevision.current === revision) setError({ message: data?.error ?? `Request failed (${res.status}).`, category: workflow === "photo" ? data?.category ?? "api_request" : undefined });
        return;
      }
      if (inputRevision.current === revision) {
        setResult(data);
        setSelected(0);
        if (workflow === "photo") setPhotoStep("results");
      }
    } catch {
      if (inputRevision.current === revision) setError({ message: "The request could not be completed.", category: workflow === "photo" ? "api_request" : undefined });
    } finally {
      setLoading(false);
    }
  };

  const downloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ brief, ...(workflow === "photo" ? { wallBoundary: photoBoundary } : {}), result }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `setbeta-${brief.grade}-${brief.requiredMove.replace(/\s+/g, "-")}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const holds = useMemo(
    () => new Map<string, DetectedHold>((result?.detectedHolds ?? []).map((h): [string, DetectedHold] => [h.id, h])),
    [result],
  );
  const candidate = result?.candidates[selected] ?? null;
  const willUseAI = Boolean(status?.aiAvailable && (workflow === "virtual" ? !forceSample : wallImage && photoInventory.length >= 5 && isValidWallBoundary(photoBoundary)));
  const canGenerate = workflow === "virtual" || Boolean(wallImage && photoInventory.length >= 5 && photoStep === "boundary" && isValidWallBoundary(photoBoundary));

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-16 pt-6 sm:px-6">
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-sky-500 text-lg font-black text-zinc-950">
            SB
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">SetBeta</h1>
            <p className="text-xs text-zinc-400">AI co-setter · virtual wall and reviewed photo concepts</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${
              status?.aiAvailable ? "border-emerald-500/40 text-emerald-300" : "border-zinc-700 text-zinc-400"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${status?.aiAvailable ? "bg-emerald-400" : "bg-zinc-500"}`} />
            {status === null ? "Checking…" : status.aiAvailable ? `AI configured · ${status.model}` : workflow === "virtual" ? "Sample mode · no API key" : "AI key needed for photos"}
          </span>
        </div>
      </header>

      <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
        <strong className="font-semibold">Concept only</strong> — requires professional installation and forerunning.
        SetBeta proposes ideas for a setter to review; it does not certify routes or grades.
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* ---------- Left: inputs ---------- */}
        <aside className="space-y-5">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-200">Demo workspace</div>
            <div className="grid grid-cols-2 gap-2">
              {(["virtual", "photo"] as const).map((w) => (
                <button key={w} type="button" onClick={() => { clearOldResult(); setWorkflow(w); }}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold ${workflow === w ? "bg-emerald-400 text-zinc-950" : "bg-zinc-900 text-zinc-300"}`}>
                  {w === "virtual" ? "Virtual wall" : "Photos (optional)"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-300">
              {workflow === "virtual" ? "Uses the wall dimensions below and 15 structured sample holds. No photos needed." : "Upload both an empty wall and loose-hold photo to use the photo workflow."}
            </p>
          </div>

          {workflow === "photo" && <div className="grid grid-cols-2 gap-3">
            <UploadCard
              label="Wall photo"
              hint="Straight-on, empty wall"
              value={wallImage}
              sampleSrc={SAMPLE_WALL}
              onFile={(f) => handleFile(f, "wall")}
              onClear={() => { clearOldResult(); setWallImage(null); setPhotoBoundary([]); setPhotoStep("inventory"); }}
            />
            <UploadCard
              label="Hold photo"
              hint="Overhead, spread out"
              value={holdsImage}
              sampleSrc={SAMPLE_HOLDS}
              onFile={(f) => handleFile(f, "holds")}
              onClear={() => { clearOldResult(); setHoldsImage(null); setPhotoInventory([]); setPhotoStep("inventory"); }}
            />
          </div>}

          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Wall width" hint="m">
                <NumberInput value={brief.wallWidthM} onChange={(n) => update("wallWidthM", n)} min={1} max={20} step={0.1} />
              </Field>
              <Field label="Wall height" hint="m">
                <NumberInput value={brief.wallHeightM} onChange={(n) => update("wallHeightM", n)} min={1} max={10} step={0.1} />
              </Field>
            </div>

            <Field
              label="Wall angle"
              hint={brief.wallAngleDeg > 0 ? `${brief.wallAngleDeg}° overhang` : brief.wallAngleDeg < 0 ? `${-brief.wallAngleDeg}° slab` : "vertical"}
            >
              <input
                type="range"
                min={-15}
                max={60}
                step={5}
                value={brief.wallAngleDeg}
                onChange={(e) => update("wallAngleDeg", Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </Field>

            <Field label="Target grade">
              <div className="grid grid-cols-8 gap-1">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => update("grade", g)}
                    className={`rounded-md py-1.5 text-xs font-semibold transition ${
                      brief.grade === g ? "bg-emerald-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Style">
                <select className={inputCls} value={brief.style} onChange={(e) => update("style", e.target.value as Brief["style"])}>
                  {STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Required move">
                <select
                  className={inputCls}
                  value={brief.requiredMove}
                  onChange={(e) => update("requiredMove", e.target.value as Brief["requiredMove"])}
                >
                  {REQUIRED_MOVES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Climber height" hint={`${brief.climberHeightCm} cm`}>
              <input
                type="range"
                min={140}
                max={200}
                step={1}
                value={brief.climberHeightCm}
                onChange={(e) => update("climberHeightCm", Number(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </Field>

            <Field label="Setter notes" hint="optional">
              <textarea
                className={`${inputCls} min-h-[60px] resize-y`}
                placeholder="e.g. Keep the heel hook but make the crux less reachy"
                maxLength={500}
                value={brief.notes}
                onChange={(e) => update("notes", e.target.value)}
              />
            </Field>

            {workflow === "virtual" && <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={forceSample}
                onChange={(e) => { clearOldResult(); setForceSample(e.target.checked); }}
                className="accent-emerald-400"
              />
              Force sample mode (skip the AI call)
            </label>}
          </div>

          {(workflow === "virtual" || photoStep === "boundary") && <button
            type="button"
            onClick={() => generate()}
            disabled={loading || !canGenerate}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-sky-400 px-4 py-3 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950/30 border-t-zinc-950" />}
            {loading ? "Generating…" : "Generate routes"}
          </button>}
          {workflow === "virtual" && <p className="-mt-3 text-center text-[11px] text-zinc-500">
            {willUseAI ? "AI will propose placements from dimensions and structured holds." : "Will use the deterministic illustrative sample engine."}
          </p>}

          {error && (
            <div className="space-y-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {process.env.NODE_ENV !== "production" && error.category && <p className="text-xs font-semibold uppercase">{FAILURE_LABEL[error.category]}</p>}
              <p>{error.message}</p>
              {workflow === "photo" && <button type="button" onClick={() => generate(true)} disabled={loading} className="rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs font-semibold hover:bg-rose-500/20">View sample concepts</button>}
            </div>
          )}
        </aside>

        {/* ---------- Right: results ---------- */}
        <main className="min-w-0 space-y-4">
          {workflow === "photo" && photoStep === "inventory" && <Section title="Hold photo · inventory">
            {holdsImage ? <div className="space-y-3">
              <button type="button" onClick={analyzeHolds} disabled={analyzingHolds}
                className="rounded-lg bg-sky-400 px-3 py-2 text-xs font-bold text-zinc-950 disabled:opacity-50">
                {analyzingHolds ? "Analyzing holds…" : photoInventory.length ? "Analyze again" : "Analyze hold photo"}
              </button>
              <InventoryEditor image={holdsImage} holds={photoInventory}
                onChange={(inventory) => { clearOldResult(); setPhotoInventory(inventory); }}
                onContinue={() => { setError(null); setPhotoStep("boundary"); }} />
            </div> : <p className="text-sm text-zinc-400">Upload a photo of your loose holds to start. You can also add markers manually after uploading.</p>}
          </Section>}

          {workflow === "photo" && photoStep === "boundary" && <Section title="Wall photo · boundary">
            {wallImage ? <WallBoundaryEditor image={wallImage} corners={photoBoundary}
              onChange={(corners) => { clearOldResult(); setPhotoBoundary(corners); }}
              onBack={() => { setError(null); setPhotoStep("inventory"); }} />
              : <p className="text-sm text-zinc-400">Upload a wall photo, then tap the four corners of the climbable area.</p>}
          </Section>}

          {workflow === "photo" && photoStep === "results" && <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => { clearOldResult(); setPhotoStep("inventory"); }} className="text-sky-300 hover:underline">← Edit holds</button>
            <button type="button" onClick={() => { clearOldResult(); setPhotoStep("boundary"); }} className="text-sky-300 hover:underline">Edit wall boundary</button>
          </div>}
          {result && (
            <>
              {result.notices.length > 0 && (
                <div className="space-y-1 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-200">
                  {result.notices.map((n) => (
                    <p key={n}>{n}</p>
                  ))}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                {result.candidates.map((c, i) => (
                  <button
                    key={`${c.name}-${i}`}
                    type="button"
                    onClick={() => setSelected(i)}
                    className={`rounded-xl border p-3 text-left transition ${
                      selected === i
                        ? "border-emerald-400 bg-emerald-400/10"
                        : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Option {i + 1}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[c.validation.status]}`}>
                        {c.validation.status}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-semibold leading-snug">{c.name}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
                      <span>
                        {c.estimatedGradeLow === c.estimatedGradeHigh
                          ? c.estimatedGradeLow
                          : `${c.estimatedGradeLow}–${c.estimatedGradeHigh}`}
                      </span>
                      <span>{c.placements.length} holds</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.round(c.confidence * 100)}%` }} />
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-500">Confidence {Math.round(c.confidence * 100)}%</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {(workflow === "virtual" || result) && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="space-y-2">
              <WallView
                src={workflow === "virtual" ? VIRTUAL_WALL : result?.mode === "ai" ? wallImage ?? SAMPLE_WALL : SAMPLE_WALL}
                virtualDimensions={workflow === "virtual" ? { width: brief.wallWidthM, height: brief.wallHeightM } : undefined}
                boundary={workflow === "photo" && result?.mode === "ai" && isValidWallBoundary(photoBoundary) ? photoBoundary as WallBoundary : undefined}
                candidate={candidate}
                holds={holds}
                highlight={highlight}
                onHover={setHighlight}
                loading={loading}
              />
              {workflow === "virtual" && <p className="text-center text-xs text-zinc-400">Virtual wall · {brief.wallWidthM} m wide × {brief.wallHeightM} m high · {brief.wallAngleDeg}° angle. Markers show proposed placements, not installed holds.</p>}
              <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-zinc-400">
                {(Object.keys(ROLE_STYLE) as PlacementRole[]).map((r) => (
                  <span key={r} className="flex items-center gap-1.5">
                    <span
                      className={r === "foot" ? "h-3 w-3 rounded-sm" : "h-3 w-3 rounded-full"}
                      style={{ backgroundColor: ROLE_STYLE[r].bg }}
                    />
                    {ROLE_STYLE[r].label}
                  </span>
                ))}
                <span className="text-zinc-500">· notch = direction the hold&apos;s edge faces</span>
              </div>
            </div>

            {candidate ? (
              <div className="space-y-3">
                <Section
                  title="Overview"
                  right={
                    <button type="button" onClick={downloadJson} className="text-[11px] text-sky-300 hover:underline">
                      Download JSON
                    </button>
                  }
                >
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-zinc-800/70 p-2">
                      <div className="text-[10px] uppercase text-zinc-500">Target</div>
                      <div className="text-lg font-bold">{candidate.targetGrade}</div>
                    </div>
                    <div className="rounded-lg bg-zinc-800/70 p-2">
                      <div className="text-[10px] uppercase text-zinc-500">Est. range</div>
                      <div className="text-lg font-bold">
                        {candidate.estimatedGradeLow}–{candidate.estimatedGradeHigh}
                      </div>
                    </div>
                    <div className="rounded-lg bg-zinc-800/70 p-2">
                      <div className="text-[10px] uppercase text-zinc-500">Confidence</div>
                      <div className="text-lg font-bold">{Math.round(candidate.confidence * 100)}%</div>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-zinc-300">
                    <span className="font-semibold text-rose-300">Crux: </span>
                    {candidate.crux}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">{candidate.rationale}</p>
                </Section>

                <Section title="Intended beta">
                  <ol className="space-y-1">
                    {candidate.beta.map((s) => (
                      <li
                        key={s.step}
                        onMouseEnter={() => setHighlight(s.holdId === WALL_HOLD_ID ? null : s.holdId)}
                        onMouseLeave={() => setHighlight(null)}
                        className={`flex gap-2 rounded-lg px-2 py-1.5 text-xs transition ${
                          highlight && highlight === s.holdId ? "bg-zinc-800" : "hover:bg-zinc-800/60"
                        }`}
                      >
                        <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-zinc-500">{s.step}</span>
                        <span className="min-w-0">
                          <span className="font-semibold text-zinc-100">{s.movement}</span>
                          <span className="text-zinc-500">
                            {" "}
                            · {s.limb} → {s.holdId === WALL_HOLD_ID ? "wall" : s.holdId}
                          </span>
                          <span className="block text-zinc-400">{s.explanation}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </Section>

                <Section title="Warnings & uncertainty">
                  <ul className="space-y-1.5 text-xs text-amber-200/90">
                    {candidate.warnings.map((w) => (
                      <li key={w} className="flex gap-2">
                        <span className="text-amber-400">▲</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                  {candidate.validation.notes.length > 0 && (
                    <div className="mt-3 border-t border-zinc-800 pt-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Validator changes
                      </div>
                      <ul className="space-y-1 text-[11px] text-zinc-400">
                        {candidate.validation.notes.map((n) => (
                          <li key={n}>• {n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Section>

                <Section title={`Hold inventory · ${result?.detectedHolds.length ?? 0} holds`}>
                  <div className="relative mb-3 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={workflow === "photo" && result?.mode === "ai" && holdsImage ? holdsImage : SAMPLE_HOLDS}
                      alt={workflow === "photo" && result?.mode === "ai" ? "Uploaded holds with confirmed hold IDs" : "Labeled sample hold inventory"}
                      className="block h-auto w-full"
                    />
                    {workflow === "photo" && result?.mode === "ai" && result.detectedHolds.map((h) => {
                      const used = candidate.placements.some((p) => p.holdId === h.id);
                      return (
                        <button
                          key={h.id}
                          type="button"
                          onMouseEnter={() => setHighlight(h.id)}
                          onMouseLeave={() => setHighlight(null)}
                          onFocus={() => setHighlight(h.id)}
                          onBlur={() => setHighlight(null)}
                          title={`${h.id} · ${h.apparentType} · estimated photo position`}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-1.5 py-0.5 text-[10px] font-bold shadow-md shadow-black/70 ${
                            highlight === h.id
                              ? "z-20 border-white bg-emerald-400 text-zinc-950"
                              : used
                                ? "z-10 border-emerald-200 bg-emerald-600 text-white"
                                : "border-zinc-300 bg-zinc-950/85 text-zinc-100"
                          }`}
                          style={{ left: `${h.xPercent}%`, top: `${h.yPercent}%` }}
                        >
                          {h.id}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(result?.detectedHolds ?? []).map((h) => {
                      const used = candidate.placements.some((p) => p.holdId === h.id);
                      return (
                        <span
                          key={h.id}
                          onMouseEnter={() => setHighlight(h.id)}
                          onMouseLeave={() => setHighlight(null)}
                          className={`rounded-md border px-2 py-0.5 text-[11px] ${
                            used ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-zinc-700 text-zinc-500"
                          }`}
                          title={`${h.relativeSize} · confidence ${Math.round(h.confidence * 100)}%`}
                        >
                          {h.id} {h.apparentType}
                        </span>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-zinc-500">
                    {workflow === "photo" && result?.mode === "ai"
                      ? `Hold locations reviewed before route generation. Check each physical hold before setting.`
                      : result?.mode === "ai" ? "Structured sample inventory. AI proposed new wall placements and beta; hold shapes and labels are illustrative." : "Structured sample inventory and deterministic illustrative placements; no AI call produced these concepts."}
                  </p>
                </Section>
              </div>
            ) : (
              <div className="hidden rounded-xl border border-dashed border-zinc-800 p-6 text-sm text-zinc-500 xl:block">
                Route details — intended beta, grade range, crux and warnings — appear here after you generate.
              </div>
            )}
          </div>}
        </main>
      </div>
    </div>
  );
}
