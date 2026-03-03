import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const DOT_SIZE = 8;
const DOT_COUNT = 3;
const ANIMATION_DURATION = 1400;
const STAGGER_DELAY = 180;

/**
 * Friendly chatbot "thinking" indicator with bouncing dots and a
 * subtle water-ripple pulse on the robot icon.
 *
 * Designed to feel warm and conversational — like the bot is actually
 * composing a thoughtful reply rather than just "loading".
 */
const ThinkingBubble = ({ isDark = true }) => {
  const dots = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0)),
  ).current;

  const iconPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // ── Bouncing dots ──
    const dotAnimations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * STAGGER_DELAY),
          Animated.timing(dot, {
            toValue: 1,
            duration: ANIMATION_DURATION / 2,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: ANIMATION_DURATION / 2,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
          // Pad so every dot loop has the same total length
          Animated.delay((DOT_COUNT - 1 - i) * STAGGER_DELAY),
        ]),
      ),
    );

    // ── Gentle icon pulse ──
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulse, {
          toValue: 1.15,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    const composite = Animated.parallel([...dotAnimations, pulse]);
    composite.start();

    return () => composite.stop();
  }, [dots, iconPulse]);

  const bubbleBg = isDark
    ? 'rgba(15,23,42,0.85)'   // slate-900 equivalent
    : 'rgba(241,245,249,0.95)'; // slate-100 equivalent
  const borderColor = isDark
    ? 'rgba(30,41,59,0.8)'
    : 'rgba(203,213,225,0.7)';
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const dotActiveColor = isDark ? '#22d3ee' : '#0891b2'; // cyan
  const dotRestColor = isDark ? 'rgba(100,116,139,0.5)' : 'rgba(148,163,184,0.5)';
  const iconColor = isDark ? '#67e8f9' : '#06b6d4';
  const iconGlow = isDark ? 'rgba(34,211,238,0.15)' : 'rgba(8,145,178,0.1)';

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        maxWidth: '85%',
        borderRadius: 20,
        borderWidth: 1,
        borderColor,
        backgroundColor: bubbleBg,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {/* Robot icon with soft pulse */}
      <Animated.View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: iconGlow,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: iconPulse }],
        }}
      >
        <MaterialCommunityIcons
          name="robot-happy-outline"
          size={18}
          color={iconColor}
        />
      </Animated.View>

      {/* Dots + label stack */}
      <View style={{ gap: 6 }}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '600',
            color: labelColor,
            letterSpacing: 0.2,
          }}
        >
          Copilot is thinking…
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {dots.map((anim, i) => {
            const translateY = anim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -6],
            });
            const scale = anim.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [1, 1.25, 1],
            });
            const backgroundColor = anim.interpolate({
              inputRange: [0, 1],
              outputRange: [dotRestColor, dotActiveColor],
            });

            return (
              <Animated.View
                key={i}
                style={{
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  backgroundColor,
                  transform: [{ translateY }, { scale }],
                }}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
};

export default ThinkingBubble;
