// Componentes de loading: shimmer partilhado, wavy progress e o
// indicador criativo (cometas de marca) — com fallback reduce-motion.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useFrameCallback,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import Svg, { Path } from 'react-native-svg';
import { loading as loadingTokens, shape, supermarketBrands } from './tokens';
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
export const WavyProgress = ({ height = loadingTokens.wavy.height, style }) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
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

// Cometas de marca: 5 pontos nas cores dos supermercados (Continente, Lidl,
const TAU = Math.PI * 2;

// Cometas de marca: 5 pontos nas cores dos supermercados (Continente, Lidl,
// Pingo Doce, Aldi, Auchan) a perseguirem-se numa órbita em torno de um núcleo
// pulsante. 100% state-driven (rAF + Views) — renderização garantida.
const BRAND_ORBIT_COLORS = Object.values(supermarketBrands).map((b) => b.color);

export const M3LoadingIndicator = ({ size = loadingTokens.loadingIndicator.size, overContent = false, style }) => {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const colors = theme.colors;

  const [t, setT] = useState(0);
  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => {
    if (reduceMotionRef.current) return;
    let raf = 0;
    const startedAt = Date.now();
    const tick = () => {
      setT((Date.now() - startedAt) / 2400);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const orbitR = size * 0.36;
  const cx = size / 2;
  const cy = size / 2;
  const dot = size * 0.17;
  const baseAngle = t * TAU;

  return (
    <View style={[styles.indicatorContainer, { width: size, height: size }, style]} accessibilityRole="progressbar" accessibilityLabel="A carregar">
      {BRAND_ORBIT_COLORS.map((color, i) => {
        // cometas: lider à frente, cauda encolhe/esbate (bunched + trail)
        const offset = i * 0.16;
        const ang = baseAngle - offset;
        const x = cx + orbitR * Math.cos(ang) - dot / 2;
        const y = cy + orbitR * Math.sin(ang) - dot / 2;
        const trail = 1 - i * 0.17;
        const d = dot * (0.55 + 0.45 * trail);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: x + (dot - d) / 2,
              top: y + (dot - d) / 2,
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: color,
              opacity: trail,
            }}
          />
        );
      })}
      {/* núcleo pulsante */}
      <View
        style={{
          position: 'absolute',
          left: cx - dot * 0.5,
          top: cy - dot * 0.5,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: colors.primary,
          opacity: 0.9 + 0.1 * Math.sin(t * TAU * 2),
          transform: [{ scale: 1 + 0.15 * Math.sin(t * TAU * 2) }],
        }}
      />
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
