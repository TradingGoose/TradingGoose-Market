"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/ui/utils";

const THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = Record<string, { label?: React.ReactNode; color?: string; theme?: Record<keyof typeof THEMES, string> }>;

const ChartContext = React.createContext<ChartConfig | null>(null);

function ChartContainer({ id, className, children, config, ...props }: React.ComponentProps<"div"> & { config: ChartConfig; children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"] }) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;
  return (
    <ChartContext.Provider value={config}>
      <div data-chart={chartId} className={cn("flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-layer]:outline-none [&_.recharts-surface]:outline-none", className)} {...props}>
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const entries = Object.entries(config).filter(([, value]) => value.color || value.theme);
  if (!entries.length) return null;
  const css = Object.entries(THEMES).map(([theme, prefix]) => `${prefix} [data-chart=${id}] {\n${entries.map(([key, value]) => { const color = value.theme?.[theme as keyof typeof THEMES] ?? value.color; return color ? `  --color-${key}: ${color};` : ""; }).filter(Boolean).join("\n")}\n}`).join("\n");
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({ active, payload, label, className }: { active?: boolean; payload?: readonly { name?: string | number; value?: unknown; color?: string; dataKey?: string | number }[]; label?: React.ReactNode; className?: string }) {
  const config = React.useContext(ChartContext);
  if (!active || !payload?.length) return null;
  return (
    <div className={cn("grid min-w-32 gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-md", className)}>
      {label ? <div className="font-medium">{label}</div> : null}
      {payload.map((item, index) => {
        const key = String(item.dataKey ?? item.name ?? index);
        return <div key={key} className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 text-muted-foreground"><span className="size-2.5 rounded-sm" style={{ backgroundColor: item.color }} />{config?.[key]?.label ?? item.name}</span><span className="font-mono font-medium tabular-nums">{typeof item.value === "number" ? item.value.toLocaleString() : String(item.value ?? "")}</span></div>;
      })}
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({ payload, className }: { payload?: readonly { dataKey?: string | number; value?: string; color?: string }[]; className?: string }) {
  const config = React.useContext(ChartContext);
  if (!payload?.length) return null;
  return <div className={cn("flex flex-wrap items-center justify-center gap-4 pt-3", className)}>{payload.map((item, index) => { const key = String(item.dataKey ?? item.value ?? index); return <span key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 rounded-sm" style={{ backgroundColor: item.color }} />{config?.[key]?.label ?? item.value}</span>; })}</div>;
}

export { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent };
