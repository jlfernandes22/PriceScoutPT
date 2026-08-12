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
// M3 LoadingIndicator (§4.6.C) — morph entre formas (cross-fade),
// para esperas 200ms–5s indeterminadas.
// ------------------------------------------------------------
const MORPH_SHAPES = [
  'M12 12 L36 12 L36 36 L12 36 Z', // quadrado
  'M24 12 A12 12 0 1 1 23.99 12 Z', // círculo
  'M24 10 L40 38 L8 38 Z', // triângulo
  'M24 8 L40 24 L24 40 L8 24 Z', // losango
  'M24 10 C34 14 40 22 40 30 C40 36 33 40 24 40 C15 40 8 36 8 30 C8 22 14 14 24 10 Z', // pílula
];

const MorphShape = ({ d, index, count, progress, color }) => {
  // useAnimatedProps é o padrão suportado para SVG no Reanimated (styles
  // animados não são aplicados de forma fiável aos elementos react-native-svg).
  const animatedProps = useAnimatedProps(() => {
    const cycle = progress.value * count;
    const distance = Math.min(Math.abs(cycle - index), count - Math.abs(cycle - index));
    const opacity = Math.max(0, 1 - distance);
    return { opacity };
  });
  return <AnimatedPath d={d} fill={color} animatedProps={animatedProps} />;
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

  // Rotação expressiva lenta (M3 Expressive): complementa o morph
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(90, { duration: loadingTokens.loadingIndicator.cycleMs * 2, easing: ReEasing.inOut(ReEasing.sin) }),
      -1,
      false
    );
    return () => cancelAnimation(rotation);
  }, [rotation]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const activeColor = overContent ? colors.onPrimaryContainer : colors.primary;
  const viewBox = `0 0 48 48`;

  if (reduceMotion) {
    return (
      <View style={[styles.indicatorContainer, { width: size, height: size }, style]} accessibilityRole="progressbar" accessibilityLabel="A carregar">
        <Svg width={size} height={size} viewBox={viewBox}>
          <Path d={MORPH_SHAPES[0]} fill={activeColor} />
        </Svg>
      </View>
    );
  }

  return (
    <View style={[styles.indicatorContainer, { width: size, height: size }, style]} accessibilityRole="progressbar" accessibilityLabel="A carregar">
      <Animated.View style={containerStyle}>
        <Svg width={size} height={size} viewBox={viewBox}>
          {MORPH_SHAPES.map((d, i) => (
            <MorphShape key={i} d={d} index={i} count={count} progress={progress} color={activeColor} />
          ))}
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
