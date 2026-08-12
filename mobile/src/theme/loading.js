// Componentes de loading MD3 (§4.6): shimmer partilhado, wavy progress,
// M3 LoadingIndicator (morph) — com fallback reduce-motion obrigatório.
import React, { createContext, useContext, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
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

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: loadingTokens.shimmer.durationMs, easing: ReEasing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(progress);
  }, [progress]);

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

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: loadingTokens.wavy.cycleMs, easing: ReEasing.inOut(ReEasing.sin) }),
      -1,
      false
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  const animatedProps = useAnimatedProps(() => {
    const phase = progress.value * 2 * Math.PI;
    const shift = progress.value * 80;
    let d = `M 0 ${height / 2}`;
    for (let x = 0; x <= 320; x += 8) {
      const y = (height / 2) + (height / 2) * 0.6 * Math.sin(phase + (x / 320) * 2 * Math.PI * 2);
      d += ` L ${x} ${y}`;
    }
    d += ` L 320 ${height} L 0 ${height} Z`;
    return { d, transform: [{ translateX: -shift }] };
  });

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
        <AnimatedPath animatedProps={animatedProps} fill={colors.primary} opacity={0.85} />
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

// customPolygon do AOSP: base + repetições rotacionadas (+ espelho opcional)
const buildReps = (base, reps, mirror = false) => {
  const pts = [];
  const step = TAU / reps;
  for (let i = 0; i < reps; i++) {
    const base2 = mirror ? base.concat(base.map((p) => ({ x: -p.x + 1, y: p.y, r: p.r || 0 }))) : base;
    for (const p of base2) {
      const [x, y] = rot2(p.x - 0.5, p.y - 0.5, step * i);
      pts.push({ x: x + 0.5, y: y + 0.5, r: p.r || 0 });
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

// Cantos arredondados: para cada vértice, insere os pontos do arco do canto.
const withRoundedCorners = (pts) => {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const r = cur.r || 0;
    if (r <= 0.001) {
      out.push([cur.x, cur.y]);
      continue;
    }
    const d = r * 0.22;
    const [v1x, v1y] = norm2(cur.x - prev.x, cur.y - prev.y);
    const [v2x, v2y] = norm2(next.x - cur.x, next.y - cur.y);
    const p1 = [cur.x + v1x * d, cur.y + v1y * d];
    const p2 = [cur.x + v2x * d, cur.y + v2y * d];
    const dot = Math.max(-1, Math.min(1, v1x * v2x + v1y * v2y));
    const theta = Math.acos(dot);
    const [bx, by] = norm2(v1x + v2x, v1y + v2y);
    const arcLen = theta > 0.05 ? d / Math.cos(theta / 2) - d : 0;
    const arcMid = [cur.x + bx * arcLen, cur.y + by * arcLen];
    out.push(p1);
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      out.push([p1[0] + (arcMid[0] - p1[0]) * t, p1[1] + (arcMid[1] - p1[1]) * t]);
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
const MORPH_SHAPES = RAW_SHAPES.map((s) => normalizeShape(resample(withRoundedCorners(s), MORPH_SAMPLES)));

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

export const M3LoadingIndicator = ({ size = loadingTokens.loadingIndicator.size, overContent = false, style }) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const colors = theme.colors;
  const progress = useSharedValue(0);
  const count = MORPH_SHAPES.length;

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: loadingTokens.loadingIndicator.cycleMs, easing: ReEasing.inOut(ReEasing.sin) }),
      -1,
      false
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  // Morph real: interpola os vértices entre a forma ativa e a seguinte
  const pathProps = useAnimatedProps(() => {
    const cycle = progress.value * count;
    const idx = Math.floor(cycle) % count;
    const frac = cycle - Math.floor(cycle);
    const a = MORPH_SHAPES[idx];
    const b = MORPH_SHAPES[(idx + 1) % count];
    const pts = new Array(MORPH_SAMPLES);
    for (let i = 0; i < MORPH_SAMPLES; i++) {
      pts[i] = [a[i][0] + (b[i][0] - a[i][0]) * frac, a[i][1] + (b[i][1] - a[i][1]) * frac];
    }
    return { d: buildMorphPath(pts) };
  });

  // Rotação oficial: -progress × 180° (sentido anti-horário)
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(1, { duration: loadingTokens.loadingIndicator.cycleMs, easing: ReEasing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(rotation);
  }, [rotation]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-rotation.value * 180}deg` }],
  }));

  const activeColor = overContent ? colors.onPrimaryContainer : colors.primary;
  const viewBox = `0 0 48 48`;

  if (reduceMotion) {
    return (
      <View style={[styles.indicatorContainer, { width: size, height: size }, style]} accessibilityRole="progressbar" accessibilityLabel="A carregar">
        <Svg width={size} height={size} viewBox={viewBox}>
          <Path d={buildMorphPath(MORPH_SHAPES[0])} fill={activeColor} />
        </Svg>
      </View>
    );
  }

  return (
    <View style={[styles.indicatorContainer, { width: size, height: size }, style]} accessibilityRole="progressbar" accessibilityLabel="A carregar">
      <Animated.View style={containerStyle}>
        <Svg width={size} height={size} viewBox={viewBox}>
          <AnimatedPath animatedProps={pathProps} fill={activeColor} />
        </Svg>
      </Animated.View>
    </View>
  );
};

// Wrapper circular para usar sobre conteúdo (M3 especifica)
export const M3LoadingOverlay = ({ size, label }) => {
  const theme = useTheme();
  return (
    <View
      style={[styles.overlay, { backgroundColor: theme.colors.surfaceContainerHigh }]}
      accessible
      accessibilityLabel={label || 'A carregar'}
    >
      <M3LoadingIndicator size={size} overContent />
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
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
