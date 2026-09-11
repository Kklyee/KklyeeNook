"use client";

import type { ComponentProps } from "react";
import { cn } from "@/renderer/src/lib/utils";
import { mono, paper } from "@/renderer/src/lib/surfaces";

export type TraceTone = "run" | "system" | "user" | "assistant" | "tool" | "approval" | "failed";

export interface TraceSegment {
  id: string;
  label: string;
  startMs: number;
  durationMs: number;
  tone: TraceTone;
}

export interface TraceLane {
  id: string;
  label: string;
  segments: readonly TraceSegment[];
}

const TONE: Record<TraceTone, string> = {
  run: "bg-foreground/28",
  system: "bg-foreground/45",
  user: "bg-blue-500/80",
  assistant: "bg-violet-500/80",
  tool: "bg-amber-500/80",
  approval: "bg-emerald-500/75",
  failed: "bg-red-500/85",
};

export function TraceWaterfall({
  lanes,
  totalMs,
  runCount,
  toolCount,
  selectedSegmentId,
  onSegmentSelect,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  lanes: readonly TraceLane[];
  totalMs: number;
  runCount: number;
  toolCount: number;
  selectedSegmentId?: string;
  onSegmentSelect?: (segmentId: string) => void;
}) {
  const total = Math.max(totalMs, 1);

  return (
    <div
      data-slot="trace-waterfall"
      className={cn(paper, "w-full overflow-hidden border-x-0", className)}
      {...props}
    >
      <div className="border-border/60 flex h-8 items-center gap-4 border-b px-3">
        <Metric label="时长" value={formatDuration(totalMs)} />
        <Metric label="轮次" value={String(runCount)} />
        <Metric label="调用" value={String(toolCount)} />
      </div>

      <div className="relative py-1.5">
        {lanes.map((lane) => (
          <div key={lane.id} className="grid h-5 grid-cols-[3.25rem_minmax(0,1fr)] items-center">
            <span className={cn(mono, "text-foreground/35 px-3 text-[10px]")}>{lane.label}</span>
            <span className="bg-foreground/[0.035] relative mr-3 h-1.5 overflow-hidden rounded-sm">
              {lane.segments.map((segment) => {
                const left = Math.min(99.4, Math.max(0, percent(segment.startMs, total)));
                const width = Math.min(
                  100 - left,
                  Math.max(0.6, percent(segment.durationMs, total)),
                );
                return (
                  <button
                    type="button"
                    key={segment.id}
                    aria-label={`${segment.label}，${formatDuration(segment.durationMs)}`}
                    title={`${segment.label} · ${formatDuration(segment.durationMs)}`}
                    onClick={() => onSegmentSelect?.(segment.id)}
                    className={cn(
                      "absolute inset-y-0 cursor-pointer rounded-[2px] outline-none transition-[filter,box-shadow,transform] hover:z-10 hover:brightness-125 focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-foreground/70 active:scale-y-150",
                      TONE[segment.tone],
                      selectedSegmentId === segment.id && "z-10 ring-1 ring-foreground/85 brightness-125",
                    )}
                    style={{ insetInlineStart: `${left}%`, width: `${width}%` }}
                  />
                );
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      <span className="text-foreground/55">{label}</span>
      <span className={cn(mono, "text-foreground/30 tabular-nums")}>{value}</span>
    </span>
  );
}

function percent(value: number, total: number) {
  return (value / total) * 100;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${Math.max(0, durationMs)}ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}
