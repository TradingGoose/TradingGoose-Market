"use client";

import { useEffect, useRef } from "react";
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  MeshPhongMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer
} from "three";
import ThreeGlobe from "three-globe";

import countries from "./globe.json";

export type GlobeArc = {
  order: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  arcAlt: number;
  color: string;
};

export type GlobeConfig = {
  pointSize: number;
  globeColor: string;
  globeOpacity: number;
  showAtmosphere: boolean;
  atmosphereColor: string;
  atmosphereAltitude: number;
  emissive: string;
  emissiveIntensity: number;
  shininess: number;
  polygonColor: string;
  ringColor: string;
  ambientLight: string;
  directionalLeftLight: string;
  directionalTopLight: string;
  pointLight: string;
  arcTime: number;
  arcLength: number;
  arcGap: number;
  rings: number;
  maxRings: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  enableDrag: boolean;
  enableRings: boolean;
  clearColor: string;
  initialPosition: {
    lat: number;
    lng: number;
  };
};

type GlobeRendererProps = {
  data: GlobeArc[];
  globeConfig: GlobeConfig;
};

type GlobePoint = {
  size: number;
  order: number;
  color: string;
  lat: number;
  lng: number;
};

type GlobeEndpoint = {
  id: string;
  color: string;
  lat: number;
  lng: number;
};

type GlobeArcGroup = {
  __data?: GlobeArc;
  __globeObjType?: string;
  children?: Array<{
    __dashAnimateStep?: number;
    material?: {
      uniforms?: {
        dashOffset?: { value: number };
        dashSize?: { value: number };
        dashTranslate?: { value: number };
        gapSize?: { value: number };
      };
    };
  }>;
};

type GlobeDashState = {
  dashOffset: number;
  dashSize: number;
  dashTranslate: number;
  gapSize: number;
};

type GlobeFeatureCollection = {
  features: object[];
};

const RING_PROPAGATION_SPEED = 3;
const CAMERA_Z = 360;
const CAMERA_TARGET_Y = -14;
const POINT_SCALE_SPEED = 10;
const POINT_VISIBILITY_THRESHOLD = 0.04;

const LIGHT_POSITIONS = {
  left: new Vector3(-400, 100, 400),
  top: new Vector3(-200, 500, 200),
  point: new Vector3(-200, 500, 200)
} as const;

const countryFeatures = (countries as GlobeFeatureCollection).features;

export function GlobeRenderer({ data, globeConfig }: GlobeRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const scene = new Scene();
    if (globeConfig.showAtmosphere) {
      /* Intentionally inverted near/far: fades the near side of the globe into
         the page background. Relies on clamp-formula smoothstep behavior. */
      scene.fog = new Fog(globeConfig.clearColor, 360, 0);
    }

    const camera = new PerspectiveCamera(40, 1, 80, 800);
    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    const globe = new ThreeGlobe({
      waitForGlobeReady: true,
      animateIn: false
    });
    const allPoints =
      globeConfig.pointSize > 0 ? createPointData(data, globeConfig.pointSize) : [];
    const isAnimated =
      globeConfig.autoRotate ||
      globeConfig.arcTime > 0 ||
      (globeConfig.enableRings && globeConfig.rings > 0);
    let animationFrameId = 0;
    let lastFrameTime = 0;
    let isLooping = false;
    let fallbackDashTranslate = 0;
    let activeRingSignature = "";
    const pointScales = new Map<string, number>(
      allPoints.map((point) => [getPointKey(point), 0])
    );
    let phi = (globeConfig.initialPosition.lng * Math.PI) / 180;
    let isDragging = false;
    let lastPointerX = 0;

    renderer.setClearColor(new Color(globeConfig.clearColor), 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "h-full w-full";
    container.appendChild(renderer.domElement);

    scene.add(new AmbientLight(globeConfig.ambientLight, 0.6));

    const directionalLeftLight = new DirectionalLight(
      globeConfig.directionalLeftLight
    );
    directionalLeftLight.position.copy(LIGHT_POSITIONS.left);
    scene.add(directionalLeftLight);

    const directionalTopLight = new DirectionalLight(
      globeConfig.directionalTopLight
    );
    directionalTopLight.position.copy(LIGHT_POSITIONS.top);
    scene.add(directionalTopLight);

    const pointLight = new PointLight(globeConfig.pointLight, 0.8);
    pointLight.position.copy(LIGHT_POSITIONS.point);
    scene.add(pointLight);

    scene.add(globe);
    configureGlobe(globe, data, globeConfig);

    const renderFrame = () => {
      renderer.render(scene, camera);
    };

    const updateCamera = () => {
      camera.position.x = CAMERA_Z * Math.sin(phi);
      camera.position.z = CAMERA_Z * Math.cos(phi);
      camera.position.y = 80 + globeConfig.initialPosition.lat * 1.2;
      camera.lookAt(0, CAMERA_TARGET_Y, 0);
    };

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);

      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      updateCamera();
      renderFrame();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const onPointerDown = (event: PointerEvent) => {
      if (!globeConfig.enableDrag) {
        return;
      }

      isDragging = true;
      lastPointerX = event.clientX;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!isDragging) {
        return;
      }

      const deltaX = event.clientX - lastPointerX;
      lastPointerX = event.clientX;
      phi -= deltaX * 0.005;
      updateCamera();

      if (!isLooping) {
        renderFrame();
      }
    };

    const endDrag = (event: PointerEvent) => {
      if (!isDragging) {
        return;
      }

      isDragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      renderer.domElement.style.cursor = globeConfig.enableDrag ? "grab" : "";
    };

    renderer.domElement.style.cursor = globeConfig.enableDrag ? "grab" : "";
    renderer.domElement.style.touchAction = "pan-y";
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", endDrag);
    renderer.domElement.addEventListener("pointercancel", endDrag);

    const ringsEnabled =
      globeConfig.enableRings && globeConfig.rings > 0 && data.length > 0;
    const animatedPointsEnabled = globeConfig.pointSize > 0 && data.length > 0;
    const syncArcEffects = (delta: number) => {
      if (globeConfig.arcTime > 0) {
        fallbackDashTranslate += delta * (1000 / globeConfig.arcTime);
      }

      const activeEndpoints = getActiveEndpoints(
        globe,
        data,
        delta,
        fallbackDashTranslate,
        globeConfig.arcLength,
        globeConfig.arcGap,
        globeConfig.arcTime === 0
      );
      const activePointKeys = getActivePointKeys(activeEndpoints);

      if (animatedPointsEnabled) {
        globe.pointsData(
          getScaledPoints(allPoints, pointScales, activePointKeys, delta) as object[]
        );
      }

      if (ringsEnabled) {
        const ringData = getRingData(activeEndpoints);
        const nextRingSignature = getRingSignature(ringData);

        if (nextRingSignature !== activeRingSignature) {
          activeRingSignature = nextRingSignature;
          globe.ringsData(ringData as object[]);
        }
      } else if (activeRingSignature !== "") {
        activeRingSignature = "";
        globe.ringsData([]);
      }
    };

    const render = (frameTime: number) => {
      const delta = (frameTime - lastFrameTime) / 1000;
      lastFrameTime = frameTime;

      if (globeConfig.autoRotate && !isDragging) {
        phi += delta * 0.15 * globeConfig.autoRotateSpeed;
        updateCamera();
      }

      syncArcEffects(delta);

      renderFrame();
      animationFrameId = window.requestAnimationFrame(render);
    };

    const startLoop = () => {
      if (!isAnimated || isLooping) {
        return;
      }

      isLooping = true;
      lastFrameTime = performance.now();
      animationFrameId = window.requestAnimationFrame(render);
    };

    const stopLoop = () => {
      if (!isLooping) {
        return;
      }

      isLooping = false;
      window.cancelAnimationFrame(animationFrameId);
    };

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        startLoop();

        if (!isAnimated) {
          syncArcEffects(1 / 60);
          renderFrame();
        }
      } else {
        stopLoop();
      }
    });
    visibilityObserver.observe(container);

    return () => {
      visibilityObserver.disconnect();
      stopLoop();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", endDrag);
      renderer.domElement.removeEventListener("pointercancel", endDrag);
      scene.remove(globe);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [data, globeConfig]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function configureGlobe(
  globe: ThreeGlobe,
  data: GlobeArc[],
  globeConfig: GlobeConfig
) {
  const globeMaterial = globe.globeMaterial() as MeshPhongMaterial;
  /* arcTime 0 disables three-globe's dash animation with the dash frozen
     outside the arc; render solid arcs instead. */
  const staticArcs = globeConfig.arcTime === 0;

  globeMaterial.color = new Color(globeConfig.globeColor);
  globeMaterial.emissive = new Color(globeConfig.emissive);
  globeMaterial.emissiveIntensity = globeConfig.emissiveIntensity;
  globeMaterial.shininess = globeConfig.shininess;
  globeMaterial.transparent = true;
  globeMaterial.opacity = globeConfig.globeOpacity;
  globeMaterial.colorWrite = globeConfig.globeOpacity > 0;
  globeMaterial.depthWrite = globeConfig.globeOpacity > 0;
  globeMaterial.needsUpdate = true;

  globe
    .hexPolygonsData(countryFeatures)
    .hexPolygonResolution(3)
    .hexPolygonMargin(0.72)
    .hexPolygonAltitude(0)
    .showAtmosphere(globeConfig.showAtmosphere)
    .atmosphereColor(globeConfig.atmosphereColor)
    .atmosphereAltitude(globeConfig.atmosphereAltitude)
    .hexPolygonColor(() => globeConfig.polygonColor);

  globe
    .arcsData(data as object[])
    .arcStartLat("startLat")
    .arcStartLng("startLng")
    .arcEndLat("endLat")
    .arcEndLng("endLng")
    .arcColor("color")
    .arcAltitude("arcAlt")
    .arcStroke((datum: object) => {
      const strokeWidths = [0.28, 0.32, 0.3] as const;
      return strokeWidths[(datum as GlobeArc).order % strokeWidths.length];
    })
    .arcDashLength(staticArcs ? 1 : globeConfig.arcLength)
    .arcDashInitialGap(staticArcs ? 0 : "order")
    .arcDashGap(staticArcs ? 0 : globeConfig.arcGap)
    .arcDashAnimateTime(globeConfig.arcTime);

  globe
    .pointsData([] as object[])
    .pointColor("color")
    .pointsMerge(true)
    .pointAltitude(0)
    .pointRadius("size");

  globe
    .ringsData([])
    .ringColor(() => globeConfig.ringColor)
    .ringMaxRadius(globeConfig.maxRings)
    .ringPropagationSpeed(RING_PROPAGATION_SPEED);

  if (globeConfig.enableRings && globeConfig.rings > 0) {
    globe.ringRepeatPeriod(
      (globeConfig.arcTime * globeConfig.arcLength) / globeConfig.rings
    );
  }
}

function createPointData(arcs: GlobeArc[], pointSize: number) {
  const points = arcs.flatMap((arc) => [
    {
      size: pointSize,
      order: arc.order,
      color: arc.color,
      lat: arc.startLat,
      lng: arc.startLng
    },
    {
      size: pointSize,
      order: arc.order,
      color: arc.color,
      lat: arc.endLat,
      lng: arc.endLng
    }
  ]);

  return dedupePoints(points);
}

function dedupePoints(points: GlobePoint[]) {
  const seen = new Set<string>();

  return points.filter((point) => {
    const key = `${point.lat}:${point.lng}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getRingData(endpoints: GlobeEndpoint[]) {
  return endpoints;
}

function getActivePointKeys(endpoints: GlobeEndpoint[]) {
  const activePointKeys = new Set<string>();

  endpoints.forEach((endpoint) => {
    activePointKeys.add(getPointKey(endpoint));
  });

  return activePointKeys;
}

function getScaledPoints(
  points: GlobePoint[],
  pointScales: Map<string, number>,
  activePointKeys: Set<string>,
  delta: number
) {
  const scaledPoints: GlobePoint[] = [];
  const scaleStep = Math.min(1, delta * POINT_SCALE_SPEED);

  points.forEach((point) => {
    const key = getPointKey(point);
    const currentScale = pointScales.get(key) ?? 0;
    const targetScale = activePointKeys.has(key) ? 1 : 0;
    const nextScale = currentScale + (targetScale - currentScale) * scaleStep;
    const smoothedScale = nextScale * nextScale * (3 - 2 * nextScale);

    pointScales.set(key, nextScale);

    if (smoothedScale <= POINT_VISIBILITY_THRESHOLD) {
      return;
    }

    scaledPoints.push({
      ...point,
      size: point.size * smoothedScale
    });
  });

  return scaledPoints;
}

function getPointKey(point: Pick<GlobePoint, "lat" | "lng">) {
  return `${point.lat}:${point.lng}`;
}

function getRingSignature(
  ringData: GlobeEndpoint[]
) {
  return ringData
    .map((ring) => ring.id)
    .sort()
    .join("|");
}

function getActiveEndpoints(
  globe: ThreeGlobe,
  arcs: GlobeArc[],
  delta: number,
  fallbackDashTranslate: number,
  dashLength: number,
  dashGap: number,
  staticArcs: boolean
) {
  if (staticArcs) {
    return [];
  }

  const activeEndpoints = new Map<string, GlobeEndpoint>();
  let hasLiveArcState = false;

  globe.traverse((object) => {
    const arcGroup = object as GlobeArcGroup;

    if (arcGroup.__globeObjType !== "arc" || !arcGroup.__data) {
      return;
    }

    const dashState = getArcDashState(arcGroup, delta);

    if (!dashState) {
      return;
    }

    hasLiveArcState = true;
    const arc = arcGroup.__data;
    const arcIndex = arcs.indexOf(arc);
    const arcIdPrefix =
      arcIndex >= 0
        ? `${arcIndex}`
        : `${arc.startLat}:${arc.startLng}:${arc.endLat}:${arc.endLng}`;

    if (isEndpointActive(1, dashState)) {
      activeEndpoints.set(`${arcIdPrefix}:start`, {
        id: `${arcIdPrefix}:start`,
        lat: arc.startLat,
        lng: arc.startLng,
        color: arc.color
      });
    }

    if (isEndpointActive(0, dashState)) {
      activeEndpoints.set(`${arcIdPrefix}:end`, {
        id: `${arcIdPrefix}:end`,
        lat: arc.endLat,
        lng: arc.endLng,
        color: arc.color
      });
    }
  });

  if (hasLiveArcState) {
    return [...activeEndpoints.values()];
  }

  arcs.forEach((arc, arcIndex) => {
    const dashState = getFallbackDashState(
      arc,
      fallbackDashTranslate,
      dashLength,
      dashGap
    );

    if (isEndpointActive(1, dashState)) {
      activeEndpoints.set(`${arcIndex}:start`, {
        id: `${arcIndex}:start`,
        lat: arc.startLat,
        lng: arc.startLng,
        color: arc.color
      });
    }

    if (isEndpointActive(0, dashState)) {
      activeEndpoints.set(`${arcIndex}:end`, {
        id: `${arcIndex}:end`,
        lat: arc.endLat,
        lng: arc.endLng,
        color: arc.color
      });
    }
  });

  return [...activeEndpoints.values()];
}

function getArcDashState(
  arcGroup: GlobeArcGroup,
  delta: number
): GlobeDashState | null {
  const arcObject = arcGroup.children?.[0];
  const uniforms = arcObject?.material?.uniforms;

  if (
    !arcObject ||
    !uniforms?.dashTranslate ||
    !uniforms.dashSize ||
    !uniforms.gapSize ||
    !uniforms.dashOffset
  ) {
    return null;
  }

  return {
    dashOffset: uniforms.dashOffset.value,
    dashSize: uniforms.dashSize.value,
    dashTranslate:
      uniforms.dashTranslate.value + (arcObject.__dashAnimateStep ?? 0) * delta,
    gapSize: uniforms.gapSize.value
  };
}

function getFallbackDashState(
  arc: GlobeArc,
  fallbackDashTranslate: number,
  dashLength: number,
  dashGap: number
): GlobeDashState {
  return {
    dashOffset: arc.order,
    dashSize: dashLength,
    dashTranslate: fallbackDashTranslate,
    gapSize: dashGap
  };
}

function isEndpointActive(relDistance: number, dashState: GlobeDashState) {
  const cycleLength = dashState.dashSize + dashState.gapSize;

  if (cycleLength <= 0) {
    return false;
  }

  const shiftedDistance =
    relDistance + dashState.dashTranslate - dashState.dashOffset;

  if (shiftedDistance < 0) {
    return false;
  }

  if (cycleLength <= dashState.dashSize) {
    return true;
  }

  return positiveModulo(shiftedDistance, cycleLength) <= dashState.dashSize;
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}
