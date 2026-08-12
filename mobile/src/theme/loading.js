// Componentes de loading MD3 (§4.6): shimmer partilhado, wavy progress,
// M3 LoadingIndicator (morph) — com fallback reduce-motion obrigatório.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  useFrameCallback,
  withRepeat,
  withTiming,
  Easing as ReEasing,
  cancelAnimation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { loading as loadingTokens, shape } from './tokens';
import { useReduceMotion } from './motion';

// ------------------------------------------------------------
// Clock partilhado — todos os shimmers de um ecrã usam o mesmo clock
// ------------------------------------------------------------
const ShimmerClockContext = createContext(null);

export const ShimmerClockProvider = ({ children }) => {
  const progress = useSharedValue(0);

  useFrameCallback((frameInfo) => {
    progress.value = (frameInfo.timeSinceFirstFrame / loadingTokens.shimmer.durationMs) % 1;
  });

  return <ShimmerClockContext.Provider value={progress}>{children}</ShimmerClockContext.Provider>;
};

// ------------------------------------------------------------
// SkeletonBlock — bloco com shimmer de 45° (base+highlight dos tokens)
// ------------------------------------------------------------
export const SkeletonBlock = ({ width, height, borderRadius = shape.small, style }) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const clock = useContext(ShimmerClockContext);
  const colors = theme.colors;

  const sweepStyle = useAnimatedStyle(() => {
    if (!clock) return {};
    const offset = -width + clock.value * (width * 2 + 40);
    return { transform: [{ translateX: offset }, { rotate: '-45deg' }] };
  });

  if (reduceMotion) {
    return (
      <View
        style={[styles.block, { width, height, borderRadius, backgroundColor: colors.surfaceVariant }, style]}
      />
    );
  }

  return (
    <View
      style={[styles.block, { width, height, borderRadius, backgroundColor: colors.surfaceVariant }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.sweep, sweepStyle]}>
        <LinearGradient
          colors={[colors.surfaceVariant, colors.surfaceContainerHighest, colors.surfaceVariant]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.sweepGradient}
        />
      </Animated.View>
    </View>
  );
};

// Lista de skeletons com a mesma geometria de uma linha (zero layout shift)
export const SkeletonRows = ({ count = 3, thumb = 44, height = 64 }) => {
  const theme = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[styles.skeletonRow, { borderBottomColor: theme.colors.outlineVariant }]}
        >
          <SkeletonBlock width={thumb} height={thumb} borderRadius={8} />
          <View style={styles.skeletonRowBody}>
            <SkeletonBlock width="70%" height={14} />
            <SkeletonBlock width="45%" height={12} style={styles.skeletonRowGap} />
          </View>
          <SkeletonBlock width={56} height={14} />
        </View>
      ))}
    </View>
  );
};

export const SkeletonChart = () => {
  const theme = useTheme();
  return (
    <View style={[styles.chartBlock, { backgroundColor: theme.colors.surfaceVariant }]}>
      <SkeletonBlock width="85%" height={14} style={styles.chartSkeleton} />
      <SkeletonBlock width="60%" height={12} style={styles.chartSkeleton} />
      <SkeletonBlock width="75%" height={12} style={styles.chartSkeleton} />
    </View>
  );
};

// ------------------------------------------------------------
// Wavy indeterminate progress (§4.6.B) — SVG animado, onda suave
// ------------------------------------------------------------
const AnimatedPath = Animated.createAnimatedComponent(Path);

export const WavyProgress = ({ height = loadingTokens.wavy.height, style }) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);
  const colors = theme.colors;

  const [wavePhase, setWavePhase] = useState(0);
  const reduceMotionRef2 = useRef(reduceMotion);
  useEffect(() => {
    if (reduceMotionRef2.current) return;
    let raf = 0;
    const startedAt = Date.now();
    const tick = () => {
      setWavePhase((Date.now() - startedAt) % loadingTokens.wavy.cycleMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phase = (wavePhase / loadingTokens.wavy.cycleMs) * 2 * Math.PI;
  const shift = (wavePhase / loadingTokens.wavy.cycleMs) * 80;
  let waveD = `M 0 ${height / 2}`;
  for (let x = 0; x <= 320; x += 8) {
    const y = (height / 2) + (height / 2) * 0.6 * Math.sin(phase + (x / 320) * 2 * Math.PI * 2);
    waveD += ` L ${x} ${y}`;
  }
  waveD += ` L 320 ${height} L 0 ${height} Z`;

  if (reduceMotion) {
    return (
      <View style={[styles.wavyTrack, { backgroundColor: colors.surfaceContainerHighest, height }, style]} accessible accessibilityRole="progressbar">
        <View style={{ width: '40%', height, backgroundColor: colors.primary }} />
      </View>
    );
  }

  return (
    <View
      style={[styles.wavyTrack, { backgroundColor: colors.surfaceContainerHighest, height }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="A carregar"
    >
      <Svg width={320} height={height}>
        <Path d={waveD} fill={colors.primary} opacity={0.85} transform={[{ translateX: -shift }]} />
      </Svg>
    </View>
  );
};

// ------------------------------------------------------------
// M3 LoadingIndicator (§4.6.C) — implementação fiel ao componente oficial
// Android (androidx.compose.material3expressive.LoadingIndicator):
//   • sequência oficial de formas (MaterialShapes): SoftBurst → Cookie9Sided →
//     Pentagon → Pill → Sunny → Cookie4Sided → Oval
//   • morph REAL por interpolação de vértices (RoundedPolygon.Morph), não cross-fade
//   • rotação no sentido anti-horário: -progress × 180°
// Para esperas 200ms–5s indeterminadas.
// ------------------------------------------------------------
const TAU = Math.PI * 2;

const rot2 = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const norm2 = (x, y) => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

// Formas oficiais (androidx.compose.material3.MaterialShapes) como polígonos
// com vértices em [0,1]² e raio de canto por vértice (0 = pontiagudo).
const buildStar = (n, inner, rounding) => {
  const pts = [];
  for (let i = 0; i < 2 * n; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / n;
    const rad = i % 2 === 0 ? 0.5 : 0.5 * inner;
    pts.push({ x: 0.5 + rad * Math.cos(ang), y: 0.5 + rad * Math.sin(ang), r: rounding });
  }
  return pts;
};

// customPolygon/doRepeat do AOSP (MaterialShapes.kt): base + repetições
// rotacionadas; com mirroring, as repetições ímpares são o espelho da base
// através do eixo do primeiro vértice (fórmula angular exata do AOSP).
const buildReps = (base, reps, mirror = false) => {
  const pts = [];
  const angleOf = (p) => Math.atan2(p.y - 0.5, p.x - 0.5);
  const distOf = (p) => Math.hypot(p.x - 0.5, p.y - 0.5);
  if (mirror) {
    const angles = base.map(angleOf);
    const distances = base.map(distOf);
    const actualReps = reps * 2;
    const sectionAngle = TAU / actualReps;
    for (let r = 0; r < actualReps; r++) {
      for (let idx = 0; idx < base.length; idx++) {
        const i = r % 2 === 0 ? idx : base.length - 1 - idx;
        if (i > 0 || r % 2 === 0) {
          const a =
            sectionAngle * r +
            (r % 2 === 0 ? angles[i] : sectionAngle - angles[i] + 2 * angles[0]);
          pts.push({
            x: 0.5 + Math.cos(a) * distances[i],
            y: 0.5 + Math.sin(a) * distances[i],
            r: base[i].r || 0,
          });
        }
      }
    }
  } else {
    const step = TAU / reps;
    for (let r = 0; r < reps; r++) {
      for (const p of base) {
        const [x, y] = rot2(p.x - 0.5, p.y - 0.5, step * r);
        pts.push({ x: x + 0.5, y: y + 0.5, r: p.r || 0 });
      }
    }
  }
  return pts;
};

const rotateShape = (pts, deg) =>
  pts.map((p) => {
    const [x, y] = rot2(p.x - 0.5, p.y - 0.5, (deg * Math.PI) / 180);
    return { x: x + 0.5, y: y + 0.5, r: p.r || 0 };
  });

// Sequência oficial indeterminada (MaterialShapes):
// SoftBurst, Cookie9Sided, Pentagon, Pill, Sunny, Cookie4Sided, Oval
const RAW_SHAPES = [
  // SoftBurst: reps=10, r=0.053
  buildReps(
    [
      { x: 0.193, y: 0.277, r: 0.053 },
      { x: 0.176, y: 0.055, r: 0.053 },
    ],
    10
  ),
  // Cookie9Sided: star(9, inner 0.8, r 0.5) rot -90°
  rotateShape(buildStar(9, 0.8, 0.5), -90),
  // Pentagon: 3 pts + espelho, r ~0.168
  buildReps(
    [
      { x: 0.5, y: -0.009, r: 0.172 },
      { x: 1.03, y: 0.365, r: 0.164 },
      { x: 0.828, y: 0.97, r: 0.169 },
    ],
    1,
    true
  ),
  // Pill: 3 pts + espelho, r 0.426 / 0 / 1.0
  buildReps(
    [
      { x: 0.961, y: 0.039, r: 0.426 },
      { x: 1.001, y: 0.428, r: 0 },
      { x: 1.0, y: 0.609, r: 1.0 },
    ],
    1,
    true
  ),
  // Sunny: star(8, inner 0.8, r 0.15)
  buildStar(8, 0.8, 0.15),
  // Cookie4Sided: 2 pts, reps=4, r ~0.245
  buildReps(
    [
      { x: 1.237, y: 1.236, r: 0.258 },
      { x: 0.5, y: 0.918, r: 0.233 },
    ],
    4
  ),
  // Oval: circle(10) × scale(1, 0.64) rot -45°
  rotateShape(
    Array.from({ length: 10 }, (_, i) => {
      const ang = (i * TAU) / 10;
      return { x: 0.5 + 0.5 * Math.cos(ang), y: 0.5 + 0.32 * Math.sin(ang), r: 0 };
    }),
    -45
  ),
];

const MORPH_SAMPLES = 24; // pontos comuns para interpolação (Morph resampling)

// Cantos arredondados por bézier quadrático (controlo no vértice): a curva
// fica sempre dentro do triângulo (p1, vértice, p2) — é matematicamente
// impossível criar auto-intersecções, mesmo com arredondamento forte.
// cut = raio * cot(θ/2) (como no AOSP), limitado a metade da aresta.
const withRoundedCorners = (pts) => {
  const out = [];
  const n = pts.length;

  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area2 += a.x * b.y - b.x * a.y;
  }
  const winding = area2 > 0 ? 1 : -1;

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const r = cur.r || 0;
    if (r <= 0.001) {
      out.push([cur.x, cur.y]);
      continue;
    }
    // vértice côncavo -> sem arredondamento (canto vivo)
    const crossRaw = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (crossRaw * winding <= 0) {
      out.push([cur.x, cur.y]);
      continue;
    }
    const [v1x, v1y] = norm2(cur.x - prev.x, cur.y - prev.y);
    const [v2x, v2y] = norm2(next.x - cur.x, next.y - cur.y);
    const dot = Math.max(-1, Math.min(1, v1x * v2x + v1y * v2y));
    const sinT = Math.sqrt(1 - dot * dot);
    if (sinT < 1e-3) {
      out.push([cur.x, cur.y]);
      continue;
    }
    // cut = r * cot(θ/2); clamp a 45% de cada aresta (evita sobreposição)
    const cut = r * (dot + 1) / sinT;
    const len1 = Math.hypot(cur.x - prev.x, cur.y - prev.y) * 0.45;
    const len2 = Math.hypot(next.x - cur.x, next.y - cur.y) * 0.45;
    const c = Math.max(0, Math.min(cut, len1, len2));
    if (c <= 1e-4) {
      out.push([cur.x, cur.y]);
      continue;
    }
    const p1 = [cur.x + v1x * c, cur.y + v1y * c];
    const p2 = [cur.x + v2x * c, cur.y + v2y * c];
    out.push(p1);
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      const mt = 1 - t;
      out.push([
        mt * mt * p1[0] + 2 * mt * t * cur.x + t * t * p2[0],
        mt * mt * p1[1] + 2 * mt * t * cur.y + t * t * p2[1],
      ]);
    }
    out.push(p2);
  }
  return out;
};

// Reamostragem por perímetro para um número comum de pontos (Morph resampling)
const resample = (pts, count) => {
  let perim = 0;
  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    perim += Math.hypot(x2 - x1, y2 - y1);
    cum.push(perim);
  }
  const out = [];
  const step = perim / count;
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (seg < pts.length && cum[seg + 1] < target) seg += 1;
    const [x1, y1] = pts[seg % pts.length];
    const [x2, y2] = pts[(seg + 1) % pts.length];
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const t = (target - cum[seg]) / segLen;
    out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return out;
};

// Normalização para a caixa unitária (equivalente ao RoundedPolygon.normalized())
const normalizeShape = (pts) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.max(maxX - minX, maxY - minY) || 1;
  return pts.map(([x, y]) => [
    0.5 + (x - (minX + maxX) / 2) / scale,
    0.5 + (y - (minY + maxY) / 2) / scale,
  ]);
};

// Polígonos finais (pontos comuns) — pré-computados no arranque.
const BASE_SHAPES = RAW_SHAPES.map((s) => normalizeShape(resample(withRoundedCorners(s), MORPH_SAMPLES)));

// Alinhamento cíclico (o mesmo que o Morph do AOSP faz): roda a sequência de
// vértices de cada forma para minimizar a distância ponto-a-ponto à anterior —
// sem isto, os vértices de índices iguais apontam para ângulos diferentes e o
// morph colapsa "para o meio" na transição.
const alignTo = (target, source) => {
  let bestShift = 0;
  let bestCost = Infinity;
  for (let s = 0; s < MORPH_SAMPLES; s++) {
    let cost = 0;
    for (let i = 0; i < MORPH_SAMPLES; i++) {
      const a = target[i];
      const b = source[(i + s) % MORPH_SAMPLES];
      cost += (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestShift = s;
    }
  }
  return [...source.slice(bestShift), ...source.slice(0, bestShift)];
};

const MORPH_SHAPES = [BASE_SHAPES[0]];
for (let i = 1; i < BASE_SHAPES.length; i++) {
  MORPH_SHAPES.push(alignTo(MORPH_SHAPES[i - 1], BASE_SHAPES[i]));
}

// Constrói o path SVG fechado com curvas suaves a partir dos pontos interpolados
const buildMorphPath = (pts) => {
  let d = `M ${(pts[0][0] * 48).toFixed(2)} ${(pts[0][1] * 48).toFixed(2)}`;
  for (let i = 1; i < pts.length; i += 3) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const p3 = pts[(i + 2) % pts.length];
    d += ` C ${(p1[0] * 48).toFixed(2)} ${(p1[1] * 48).toFixed(2)}, ${(p2[0] * 48).toFixed(2)} ${(p2[1] * 48).toFixed(2)}, ${(p3[0] * 48).toFixed(2)} ${(p3[1] * 48).toFixed(2)}`;
  }
  return d + ' Z';
};


// Path do morph entre duas formas com uma fração 0..1 (com overshoot permitido)
const morphPathForPair = (a, b, frac) => {
  const pts = new Array(MORPH_SAMPLES);
  for (let i = 0; i < MORPH_SAMPLES; i++) {
    pts[i] = [a[i][0] + (b[i][0] - a[i][0]) * frac, a[i][1] + (b[i][1] - a[i][1]) * frac];
  }
  return buildMorphPath(pts);
};

// Cadência oficial (LoadingIndicator.kt): cada transição é um spring amortecido
// (dampingRatio 0.6, stiffness 200) que assenta em ~350ms, seguido de pausa até
// aos 650ms (MorphIntervalMillis). Rotação linear contínua: 360° / 4666ms.
const MORPH_INTERVAL_MS = 650;
const SPRING_DURATION_MS = 350;
const ROTATION_CYCLE_MS = 4666;

// Resposta de um spring amortecido de 0 a 1 (overshoot ≈ 8% — o "saltinho")
const springResponse = (tSec) => {
  const omega = Math.sqrt(200);
  const zeta = 0.6;
  const omegad = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-zeta * omega * tSec);
  return 1 - e * (Math.cos(omegad * tSec) + ((zeta * omega) / omegad) * Math.sin(omegad * tSec));
};

export const M3LoadingIndicator = ({ size = loadingTokens.loadingIndicator.size, overContent = false, style }) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const colors = theme.colors;
  const activeColor = overContent ? colors.onPrimaryContainer : colors.primary;
  const viewBox = `0 0 48 48`;

  // Animação por estado React + requestAnimationFrame (thread JS).
  // Garante o re-render em qualquer dispositivo — os animated props do SVG
  // (worklet/UI-thread) não atualizam o `d` do path neste stack.
  const [morph, setMorph] = useState({ idx: 0, frac: 0, scale: 1, rot: 0 });

  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => {
    if (reduceMotionRef.current) return;
    let raf = 0;
    const startedAt = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const idx = Math.floor(elapsed / MORPH_INTERVAL_MS) % MORPH_SHAPES.length;
      const tIn = elapsed % MORPH_INTERVAL_MS;
      const tt = Math.min(1, tIn / SPRING_DURATION_MS);
      const spring = springResponse(tt * (SPRING_DURATION_MS / 1000));
      // AOSP: progresso do morph é COERIDO (sem overshoot na geometria);
      // o "saltinho" é simulado na escala do desenho.
      const frac = Math.max(0, Math.min(1, spring));
      const scale = 1 + Math.max(0, spring - 1);
      // Rotação horária: progresso do morph × 90° + 90° por passo + contínua (360°/4666ms)
      const rot = frac * 90 + ((idx + 1) % 4) * 90 + ((elapsed % ROTATION_CYCLE_MS) / ROTATION_CYCLE_MS) * 360;
      setMorph({ idx, frac, scale, rot });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const a = MORPH_SHAPES[morph.idx];
  const b = MORPH_SHAPES[(morph.idx + 1) % MORPH_SHAPES.length];
  const d = useMemo(() => morphPathForPair(a, b, morph.frac), [morph.idx, morph.frac]);
  const rotationDeg = morph.rot;
  const bounceScale = morph.scale;

  return (
    <View style={[styles.indicatorContainer, { width: size, height: size }, style]} accessibilityRole="progressbar" accessibilityLabel="A carregar">
      <View style={{ transform: [{ rotate: `${rotationDeg}deg` }, { scale: bounceScale }] }}>
        <Svg width={size} height={size} viewBox={viewBox}>
          <Path d={d} fill={activeColor} />
        </Svg>
      </View>
    </View>
  );
};

// Wrapper circular para usar sobre conteúdo (M3 especifica):
// ContainerWidth/Height = 48dp; forma ativa = ActiveSize 38dp (≈79% do contentor);
// ContainedContainerColor = PrimaryContainer; ContainedActiveColor = OnPrimaryContainer.
export const M3LoadingOverlay = ({ size = 48, label }) => {
  const theme = useTheme();
  return (
    <View
      style={[styles.overlay, { backgroundColor: theme.colors.primaryContainer, width: size, height: size, borderRadius: size / 2 }]}
      accessible
      accessibilityLabel={label || 'A carregar'}
    >
      <M3LoadingIndicator size={size * 0.79} overContent />
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden',
  },
  sweep: {
    position: 'absolute',
    top: -20,
    bottom: -20,
    left: 0,
    width: 40,
  },
  sweepGradient: {
    flex: 1,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  skeletonRowBody: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  skeletonRowGap: {
    marginTop: 8,
  },
  chartBlock: {
    height: 180,
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  chartSkeleton: {
    marginVertical: 6,
  },
  wavyTrack: {
    borderRadius: 2,
    overflow: 'hidden',
  },
  indicatorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
