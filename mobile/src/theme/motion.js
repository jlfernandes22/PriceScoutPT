// Motion helpers MD3 (Reanimated) — press scale, entradas/saídas, reduce-motion.
import { useState, useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import Animated, {
  useSharedValue,
  withSpring,
  useAnimatedStyle,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideInUp,
  LinearTransition,
  cubicBezier,
} from 'react-native-reanimated';
import { toReanimatedSpring, spring, duration, easing } from './tokens';

// Gate global de acessibilidade (fallback obrigatório — §4.6.D / §6)
export const useReduceMotion = () => {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      mounted = false;
      if (sub && sub.remove) sub.remove();
    };
  }, []);

  return reduceMotion;
};

// §6 — useM3PressScale: press scale com spring espacial rápido (M3 Expressive).
export const useM3PressScale = (targetScale = 0.96) => {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = () => {
    scale.value = reduceMotion
      ? 1
      : withSpring(targetScale, toReanimatedSpring(spring.spatialFast));
  };
  const onPressOut = () => {
    scale.value = withSpring(1, toReanimatedSpring(spring.spatialFast));
  };

  return { style, onPressIn, onPressOut };
};

// §4.5 — presets de entrada/saída (tabela de pareamento do spec)
const emphasizedDecelerate = cubicBezier(
  easing.emphasizedDecelerate.x1,
  easing.emphasizedDecelerate.y1,
  easing.emphasizedDecelerate.x2,
  easing.emphasizedDecelerate.y2
);

export const m3FadeIn = FadeIn.duration(duration.medium2).easing(emphasizedDecelerate);
export const m3FadeOut = FadeOut.duration(duration.medium2).easing(emphasizedDecelerate);

// Sheets: deslizam de baixo (Snackbar, bottom sheets) — §4.5
export const m3SlideInDown = SlideInDown.duration(duration.medium2).easing(emphasizedDecelerate);
export const m3SlideInUp = SlideInUp.duration(duration.medium2).easing(emphasizedDecelerate);

// Listas: layout animation curta (short3 + standard) — §4.5 "Nav tab switch"
export const m3Layout = LinearTransition.duration(duration.short3)
  .easing(cubicBezier(easing.standard.x1, easing.standard.y1, easing.standard.x2, easing.standard.y2));

export { Animated };
