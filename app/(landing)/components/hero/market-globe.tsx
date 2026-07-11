"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo, useSyncExternalStore } from "react";

import type { GlobeArc, GlobeConfig } from "./globe-renderer";

const GlobeRenderer = dynamic(
  () => import("./globe-renderer").then((mod) => mod.GlobeRenderer),
  { ssr: false }
);

const PRIMARY_GLOBE_COLOR = "#ffcc00";

const marketArcTemplate = [
  {
    order: 1,
    startLat: 40.7128,
    startLng: -74.006,
    endLat: 51.5074,
    endLng: -0.1278,
    arcAlt: 0.19
  },
  {
    order: 1,
    startLat: 51.5074,
    startLng: -0.1278,
    endLat: 50.1109,
    endLng: 8.6821,
    arcAlt: 0.15
  },
  {
    order: 2,
    startLat: 50.1109,
    startLng: 8.6821,
    endLat: 35.6762,
    endLng: 139.6503,
    arcAlt: 0.28
  },
  {
    order: 2,
    startLat: 35.6762,
    startLng: 139.6503,
    endLat: 22.3193,
    endLng: 114.1694,
    arcAlt: 0.16
  },
  {
    order: 3,
    startLat: 22.3193,
    startLng: 114.1694,
    endLat: 1.3521,
    endLng: 103.8198,
    arcAlt: 0.14
  },
  {
    order: 3,
    startLat: 1.3521,
    startLng: 103.8198,
    endLat: -33.8688,
    endLng: 151.2093,
    arcAlt: 0.19
  },
  {
    order: 4,
    startLat: 19.076,
    startLng: 72.8777,
    endLat: 31.2304,
    endLng: 121.4737,
    arcAlt: 0.18
  },
  {
    order: 4,
    startLat: -23.5505,
    startLng: -46.6333,
    endLat: 40.7128,
    endLng: -74.006,
    arcAlt: 0.25
  }
] as const;

const globeColors = {
  light: {
    arc: PRIMARY_GLOBE_COLOR,
    polygon: "rgba(255, 204, 0, 0.58)",
    ring: "rgba(255, 204, 0, 0.3)",
    clear: "#ffffff"
  },
  dark: {
    arc: PRIMARY_GLOBE_COLOR,
    polygon: "rgba(255, 204, 0, 0.68)",
    ring: "rgba(255, 204, 0, 0.38)",
    clear: "#000000"
  }
} as const;

const REDUCED_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

export function MarketGlobe() {
  const { resolvedTheme } = useTheme();
  const prefersReducedMotion = usePrefersReducedMotion();
  const isDark = resolvedTheme === "dark";
  const colors = isDark ? globeColors.dark : globeColors.light;

  const arcs = useMemo<GlobeArc[]>(
    () =>
      marketArcTemplate.map((arc) => ({
        ...arc,
        color: colors.arc
      })),
    [colors]
  );

  const globeConfig = useMemo<GlobeConfig>(
    () => ({
      pointSize: 0.9,
      globeColor: "#000000",
      globeOpacity: 0,
      showAtmosphere: false,
      atmosphereColor: colors.ring,
      atmosphereAltitude: 0.08,
      emissive: "#000000",
      emissiveIntensity: 0,
      shininess: 0,
      polygonColor: colors.polygon,
      ringColor: colors.ring,
      ambientLight: "#ffffff",
      directionalLeftLight: "#ffffff",
      directionalTopLight: "#ffffff",
      pointLight: "#ffffff",
      arcTime: prefersReducedMotion ? 0 : 3200,
      arcLength: 0.92,
      arcGap: 4,
      rings: prefersReducedMotion ? 0 : 1,
      maxRings: 3,
      autoRotate: !prefersReducedMotion,
      autoRotateSpeed: 0.6,
      enableDrag: true,
      enableRings: !prefersReducedMotion,
      clearColor: colors.clear,
      initialPosition: {
        lat: 0,
        lng: 0
      }
    }),
    [colors, prefersReducedMotion]
  );

  return (
    <div className="absolute inset-x-0 -top-[12%] -bottom-[12%]">
      <div
        aria-hidden="true"
        className="absolute inset-0 "
      />
      <div className="relative z-10 h-full w-full">
        <GlobeRenderer data={arcs} globeConfig={globeConfig} />
      </div>
    </div>
  );
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mediaQuery = window.matchMedia(REDUCED_MEDIA_QUERY);
      mediaQuery.addEventListener("change", onStoreChange);

      return () => {
        mediaQuery.removeEventListener("change", onStoreChange);
      };
    },
    () => window.matchMedia(REDUCED_MEDIA_QUERY).matches,
    () => false
  );
}
