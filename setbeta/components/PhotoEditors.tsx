"use client";

import { useState, type MouseEvent } from "react";
import { HOLD_SIZES, HOLD_TYPES, type DetectedHold, type Point } from "@/lib/schema";
import { addHold, isValidWallBoundary, removeHold, updateHold } from "@/lib/photoWorkflow";

function clickPoint(event: MouseEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    xPercent: Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10,
    yPercent: Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10,
  };
}

type InventoryEditorProps = {
  image: string;
  holds: DetectedHold[];
  onChange: (holds: DetectedHold[]) => void;
  onContinue: () => void;
};

export function InventoryEditor({ image, holds, onChange, onContinue }: InventoryEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<"add" | "move" | null>(null);
  const selected = holds.find((hold) => hold.id === selectedId) ?? holds[0] ?? null;
  const changeHold = (id: string, changes: Partial<Omit<DetectedHold, "id">>) => onChange(updateHold(holds, id, changes));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">1 · Confirm the loose holds</h2>
          <p className="text-xs text-zinc-400">Check each label and grip guess. Select a hold to move or edit it.</p>
        </div>
        <button type="button" onClick={() => setPlacing(placing === "add" ? null : "add")}
          className="rounded-lg border border-emerald-500/50 px-3 py-1.5 text-xs font-semibold text-emerald-200">
          {placing === "add" ? "Cancel adding" : "Add hold"}
        </button>
      </div>
      {placing && <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
        {placing === "add" ? "Tap the center of a missing hold in the photo." : `Tap the correct center of ${selected?.id ?? "the selected hold"}.`}
      </p>}
      <div onClick={(event) => {
        if (!placing) return;
        const point = clickPoint(event);
        if (placing === "add") {
          const updated = addHold(holds, point);
          onChange(updated);
          setSelectedId(updated[updated.length - 1].id);
        } else if (selected) onChange(updateHold(holds, selected.id, point));
        setPlacing(null);
      }} className={`relative overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 ${placing ? "cursor-crosshair" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="Loose holds to review" className="block h-auto w-full" draggable={false} />
        {holds.map((hold) => (
          <button key={hold.id} type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(hold.id); }}
            title={`${hold.id} · ${hold.apparentType} · ${Math.round(hold.confidence * 100)}% confidence`}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-1 text-xs font-bold shadow-lg shadow-black/70 ${selected?.id === hold.id ? "z-20 border-white bg-emerald-400 text-zinc-950" : "border-zinc-200 bg-zinc-950/90 text-white"}`}
            style={{ left: `${hold.xPercent}%`, top: `${hold.yPercent}%` }}>{hold.id}</button>
        ))}
      </div>
      {holds.length === 0 && <p className="text-xs text-zinc-400">Analyze the photo to get hold labels, or add holds manually.</p>}
      {holds.length > 0 && <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-700" aria-label="Numbered hold inventory">
        {holds.map((hold) => <button key={hold.id} type="button" onClick={() => setSelectedId(hold.id)}
          className={`grid w-full grid-cols-[2.5rem_1fr_auto] gap-2 border-b border-zinc-800 px-3 py-1.5 text-left text-xs last:border-b-0 ${selected?.id === hold.id ? "bg-emerald-500/15 text-emerald-200" : "text-zinc-300 hover:bg-zinc-800"}`}>
          <strong>{hold.id}</strong><span>{hold.apparentType} · {hold.relativeSize}</span>
          <span className="text-right text-zinc-400">({hold.xPercent}%, {hold.yPercent}%) · {Math.round(hold.confidence * 100)}%</span>
        </button>)}
      </div>}
      {selected && <div className="grid gap-2 rounded-xl border border-zinc-700 bg-zinc-900/70 p-3 sm:grid-cols-[auto_1fr_1fr_auto_auto] sm:items-end">
        <span className="text-sm font-bold text-emerald-300">{selected.id}</span>
        <label className="text-[11px] text-zinc-400">Grip type
          <select aria-label={`${selected.id} grip type`} value={selected.apparentType}
            onChange={(event) => changeHold(selected.id, { apparentType: event.target.value as DetectedHold["apparentType"] })}
            className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-xs text-white">
            {HOLD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-zinc-400">Size
          <select aria-label={`${selected.id} size`} value={selected.relativeSize}
            onChange={(event) => changeHold(selected.id, { relativeSize: event.target.value as DetectedHold["relativeSize"] })}
            className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-xs text-white">
            {HOLD_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setPlacing("move")} className="rounded-md border border-zinc-600 px-2 py-1.5 text-xs text-zinc-200">Move</button>
        <button type="button" onClick={() => { onChange(removeHold(holds, selected.id)); setSelectedId(null); setPlacing(null); }}
          className="rounded-md border border-rose-500/50 px-2 py-1.5 text-xs text-rose-300">Remove</button>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">{holds.length} confirmed hold{holds.length === 1 ? "" : "s"} · at least 5 needed for a route</span>
        <button type="button" disabled={holds.length < 5} onClick={onContinue}
          className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-zinc-950 disabled:opacity-40">Continue to wall boundary →</button>
      </div>
    </div>
  );
}

const CORNER_NAMES = ["top-left", "top-right", "bottom-right", "bottom-left"];

export function WallBoundaryEditor({ image, corners, onChange, onBack }: {
  image: string;
  corners: Point[];
  onChange: (corners: Point[]) => void;
  onBack: () => void;
}) {
  const valid = isValidWallBoundary(corners);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">2 · Mark the climbable wall</h2>
          <p className="text-xs text-zinc-400">Tap the four corners in this order: top-left, top-right, bottom-right, bottom-left.</p>
        </div>
        <button type="button" onClick={onBack} className="text-xs text-sky-300 hover:underline">← Edit holds</button>
      </div>
      <p className="text-xs text-emerald-200">{corners.length < 4 ? `Next: ${CORNER_NAMES[corners.length]} corner` : valid ? "Boundary ready. Review the outline, then generate routes." : "Corners crossed or area is too small. Undo or reset and try again."}</p>
      <div onClick={(event) => { if (corners.length < 4) onChange([...corners, clickPoint(event)]); }}
        className={`relative overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 ${corners.length < 4 ? "cursor-crosshair" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="Wall photo for boundary selection" className="block h-auto w-full" draggable={false} />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {corners.length === 4 && <polygon points={corners.map((p) => `${p.xPercent},${p.yPercent}`).join(" ")}
            fill="rgba(16,185,129,0.15)" stroke={valid ? "#34d399" : "#fb7185"} strokeWidth="0.7" />}
          {corners.length > 1 && corners.length < 4 && <polyline points={corners.map((p) => `${p.xPercent},${p.yPercent}`).join(" ")}
            fill="none" stroke="#34d399" strokeWidth="0.7" />}
          {corners.map((p, index) => <g key={index}>
            <circle cx={p.xPercent} cy={p.yPercent} r="2.2" fill="#10b981" stroke="white" strokeWidth="0.5" />
            <text x={p.xPercent} y={p.yPercent} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="2.5" fontWeight="bold">{index + 1}</text>
          </g>)}
        </svg>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={corners.length === 0} onClick={() => onChange(corners.slice(0, -1))}
          className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs disabled:opacity-40">Undo corner</button>
        <button type="button" disabled={corners.length === 0} onClick={() => onChange([])}
          className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs disabled:opacity-40">Reset boundary</button>
      </div>
    </div>
  );
}
