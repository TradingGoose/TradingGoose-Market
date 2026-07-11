"use client";

import { memo, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/ui/utils";

type CellCoords = { row: number; col: number };

export function BackgroundRippleEffect({
  rows = 8,
  cols = 27,
  cellSize = 56.815,
  maskClassName = "mask-radial-from-20% mask-radial-at-top",
  interactive = true
}: {
  rows?: number;
  cols?: number;
  cellSize?: number;
  maskClassName?: string;
  interactive?: boolean;
}) {
  const [clickedCell, setClickedCell] = useState<CellCoords | null>(null);
  const [hoveredCell, setHoveredCell] = useState<CellCoords | null>(null);
  const [rippleKey, setRippleKey] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!interactive) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const getCellFromPointer = (event: PointerEvent) => {
      const gridEl = gridRef.current;
      if (!gridEl) {
        return null;
      }

      const rect = gridEl.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        return null;
      }

      const col = Math.floor(x / cellSize);
      const row = Math.floor(y / cellSize);

      if (row < 0 || row >= rows || col < 0 || col >= cols) {
        return null;
      }

      return { row, col };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const cell = getCellFromPointer(event);
      setHoveredCell((previousCell) => {
        const isSameCell =
          previousCell?.row === cell?.row && previousCell?.col === cell?.col;

        return isSameCell ? previousCell : cell;
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const cell = getCellFromPointer(event);

      if (!cell) {
        return;
      }

      setClickedCell(cell);
      setRippleKey((key) => key + 1);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [cellSize, cols, interactive, rows]);

  return (
    <div className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-center">
      <div className="relative flex h-auto w-auto justify-center overflow-hidden">
        <DivGrid
          className={cn(maskClassName, "opacity-40")}
          rows={rows}
          cols={cols}
          cellSize={cellSize}
          clickedCell={clickedCell}
          hoveredCell={hoveredCell}
          rippleKey={rippleKey}
          gridRef={gridRef}
        />
      </div>
    </div>
  );
}

type DivGridProps = {
  className?: string;
  rows: number;
  cols: number;
  cellSize: number;
  clickedCell: CellCoords | null;
  hoveredCell: CellCoords | null;
  rippleKey: number;
  gridRef: React.RefObject<HTMLDivElement>;
};

function DivGrid({
  className,
  rows,
  cols,
  cellSize,
  clickedCell,
  hoveredCell,
  rippleKey,
  gridRef
}: DivGridProps) {
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
    width: cols * cellSize,
    height: rows * cellSize,
    marginInline: "auto"
  };
  /* Alternating animation classes restart the ripple without remounting cells. */
  const rippleClass = clickedCell
    ? rippleKey % 2 === 0
      ? "animate-cell-ripple"
      : "animate-cell-ripple-b"
    : null;

  return (
    <div ref={gridRef} className={cn("relative z-0", className)} style={gridStyle}>
      {Array.from({ length: rows * cols }, (_, cellIndex) => {
        const rowIndex = Math.floor(cellIndex / cols);
        const colIndex = cellIndex % cols;

        return (
          <RippleCell
            key={cellIndex}
            rowIndex={rowIndex}
            colIndex={colIndex}
            clickedRow={clickedCell?.row ?? null}
            clickedCol={clickedCell?.col ?? null}
            rippleClass={rippleClass}
            isHovered={
              hoveredCell?.row === rowIndex && hoveredCell?.col === colIndex
            }
          />
        );
      })}
    </div>
  );
}

type RippleCellProps = {
  rowIndex: number;
  colIndex: number;
  clickedRow: number | null;
  clickedCol: number | null;
  rippleClass: string | null;
  isHovered: boolean;
};

type CellStyle = React.CSSProperties & {
  "--delay"?: string;
  "--duration"?: string;
};

const RippleCell = memo(function RippleCell({
  rowIndex,
  colIndex,
  clickedRow,
  clickedCol,
  rippleClass,
  isHovered
}: RippleCellProps) {
  const hasRipple =
    rippleClass !== null && clickedRow !== null && clickedCol !== null;
  const distance = hasRipple
    ? Math.hypot(clickedRow - rowIndex, clickedCol - colIndex)
    : 0;
  const style: CellStyle = hasRipple
    ? {
        "--delay": `${Math.max(0, distance * 55)}ms`,
        "--duration": `${200 + distance * 80}ms`
      }
    : {};

  return (
    <div
      className={cn(
        "cell relative border-[1px] opacity-50 shadow-inner shadow-lg transition-all duration-150",
        "bg-primary/10 border-neutral-500",
        hasRipple && rippleClass,
        isHovered && "opacity-90 border-primary brightness-95"
      )}
      style={style}
    />
  );
});
