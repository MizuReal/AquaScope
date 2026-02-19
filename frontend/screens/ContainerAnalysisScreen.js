import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Image,
  Animated,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import PredictButton from '../components/PredictButton';
import { useAppTheme } from '../utils/theme';
import { analyzeContainer } from '../utils/api';

/* ── Helpers ────────────────────────────────────────────────── */

const CLASS_META = {
  Clean:      { color: '#22c55e', label: 'Clean',       icon: '✓' },
  LightMoss:  { color: '#facc15', label: 'Light Moss',  icon: '●' },
  MediumMoss: { color: '#f97316', label: 'Medium Moss', icon: '▲' },
  HeavyMoss:  { color: '#ef4444', label: 'Heavy Moss',  icon: '✕' },
  Unknown:    { color: '#64748b', label: 'Not Recognized', icon: '?' },
};

const severityNote = (cls, isValid) => {
  if (!isValid) {
    return 'The image could not be confidently classified. Ensure the photo clearly shows the container surface and try again.';
  }
  switch (cls) {
    case 'Clean':
      return 'Container surface is clean — no biological growth detected.';
    case 'LightMoss':
      return 'Minor biological growth observed. Consider routine cleaning.';
    case 'MediumMoss':
      return 'Moderate moss/algae build-up. Cleaning is recommended before next use.';
    case 'HeavyMoss':
      return 'Significant contamination detected. Immediate cleaning or replacement advised.';
    default:
      return '';
  }
};

/* ── Confidence bar component ──────────────────────────────── */

const ConfidenceBar = ({ label, value, color, isDark }) => {
  const barAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barAnim, {
      toValue: value,
      duration: 600,
      delay: 100,
      useNativeDriver: false,
    }).start();
  }, [value, barAnim]);

  const pct = Math.round(value * 100);

  return (
    <View className="mb-2">
      <View className="flex-row items-center justify-between mb-0.5">
        <Text className={`text-[11px] font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          {label}
        </Text>
        <Text className={`text-[11px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
          {pct}%
        </Text>
      </View>
      <View className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
        <Animated.View
          style={{
            height: '100%',
            borderRadius: 9999,
            backgroundColor: color,
            width: barAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          }}
        />
      </View>
    </View>
  );
};

/* ── Screen ────────────────────────────────────────────────── */

const ContainerAnalysisScreen = ({ onNavigate }) => {
  const { isDark } = useAppTheme();
  const [image, setImage] = useState(null);
  const [result, setResult] = useState(null);   // API result
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const screenAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(screenAnim, {
      toValue: 1,
      duration: 450,
      delay: 80,
      useNativeDriver: true,
    }).start();
  }, [screenAnim]);

  /* Capture → upload → classify */
  const handleCapture = async () => {
    setError('');
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera access is required to analyze containers.');
      return;
    }

    const pickerResult = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      base64: false,
    });

    if (pickerResult.canceled || !pickerResult.assets?.length) return;

    const asset = pickerResult.assets[0];
    setImage(asset);
    setResult(null);
    setLoading(true);

    try {
      const analysis = await analyzeContainer(asset);
      setResult(analysis);
    } catch (err) {
      setError(err.message || 'Analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  /* Derive display data from result */
  const topClass = result?.predicted_class;
  const isValid = result?.is_valid ?? false;
  const meta = topClass ? (CLASS_META[topClass] || CLASS_META.Unknown) : null;
  const probabilities = result?.probabilities ?? {};

  return (
    <KeyboardAvoidingView
      className={`flex-1 ${isDark ? 'bg-aquadark' : 'bg-slate-100'}`}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View
        className="flex-1"
        style={{
          opacity: screenAnim,
          transform: [
            {
              translateY: screenAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
          ],
        }}
      >
      <View className="px-5 pt-10 pb-3">
        <View className="mb-2 flex-row items-center justify-between">
          <TouchableOpacity
            activeOpacity={0.8}
            className={`rounded-full border px-3 py-1.5 ${isDark ? 'border-sky-900/70 bg-aquadark/80' : 'border-slate-300 bg-slate-100'}`}
            onPress={() => onNavigate && onNavigate('home')}
          >
            <Text className={`text-[12px] font-medium ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>⟵ Dashboard</Text>
          </TouchableOpacity>
          <View className={`rounded-full border px-3 py-1 ${isDark ? 'border-slate-800/70 bg-slate-950/70' : 'border-slate-300 bg-slate-100'}`}>
            <Text className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              Ops Live
            </Text>
          </View>
        </View>
        <Text className={`text-[22px] font-bold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>Container analysis</Text>
        <Text className={`mt-1 text-[13px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Capture a container image to detect moss/algae growth and assess cleanliness.
        </Text>
      </View>

      <ScrollView
        className="px-5"
        contentContainerClassName="pb-10 gap-4"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Capture card ── */}
        <View className={`mt-1 rounded-2xl border p-4 ${isDark ? 'border-sky-900/70 bg-sky-950/40' : 'border-slate-300 bg-sky-50'}`}>
          <Text className={`text-[11px] font-medium uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
            Capture
          </Text>
          <Text className={`mt-1 text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Use the camera to capture the current container or sampling bottle.
          </Text>

          <View className="mt-4">
            <PredictButton
              title={image ? 'Retake container photo' : 'Capture container photo'}
              onPress={handleCapture}
              disabled={loading}
            />
            {error ? (
              <Text className="mt-2 text-[11px] text-red-400">{error}</Text>
            ) : null}
          </View>
        </View>

        {/* ── Analysis snapshot card ── */}
        <View className={`rounded-2xl border p-4 ${isDark ? 'border-sky-900/80 bg-aquadark/80' : 'border-slate-300 bg-white'}`}>
          <Text className={`text-[11px] font-medium uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
            Analysis snapshot
          </Text>

          {loading ? (
            <View className="mt-6 mb-4 items-center">
              <ActivityIndicator size="large" color={isDark ? '#38bdf8' : '#0284c7'} />
              <Text className={`mt-3 text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Running moss classification…
              </Text>
            </View>
          ) : image && result ? (
            <View className="mt-3">
              {/* Image + verdict row */}
              <View className="flex-row gap-3">
                <View className={`h-28 w-24 overflow-hidden rounded-xl border ${isDark ? 'border-sky-900/80 bg-slate-900' : 'border-slate-300 bg-slate-100'}`}>
                  <Image
                    source={{ uri: image.uri }}
                    className="h-full w-full"
                    resizeMode="cover"
                  />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <View style={{ backgroundColor: meta?.color || '#64748b' }} className="h-5 w-5 rounded-full items-center justify-center">
                      <Text className="text-[10px] text-white font-bold">{meta?.icon}</Text>
                    </View>
                    <Text className={`text-[14px] font-bold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
                      {meta?.label || topClass}
                    </Text>
                    <Text className={`text-[12px] font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {Math.round(result.confidence * 100)}%
                    </Text>
                  </View>
                  {!isValid && (
                    <View className={`mt-2 rounded-lg px-2.5 py-1.5 ${isDark ? 'bg-amber-900/40' : 'bg-amber-50'}`}>
                      <Text className={`text-[11px] font-semibold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                        ⚠ Below confidence threshold ({Math.round(result.confidence * 100)}% &lt; 85%)
                      </Text>
                    </View>
                  )}
                  <Text className={`mt-1.5 text-[12px] leading-[17px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {severityNote(topClass, isValid)}
                  </Text>
                  {isValid && (
                    <Text className={`mt-1.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                      Combine with pH, turbidity and nutrient data for final assessment.
                    </Text>
                  )}
                </View>
              </View>

              {/* Confidence breakdown */}
              <View className={`mt-4 rounded-xl border p-3 ${isDark ? 'border-sky-900/60 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}>
                <Text className={`text-[11px] font-medium uppercase tracking-wide mb-2 ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                  Confidence breakdown
                </Text>
                {Object.entries(CLASS_META).map(([cls, { color, label }]) => (
                  <ConfidenceBar
                    key={cls}
                    label={label}
                    value={probabilities[cls] ?? 0}
                    color={color}
                    isDark={isDark}
                  />
                ))}
              </View>
            </View>
          ) : image && !result ? (
            <Text className={`mt-3 text-[12px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
              Image captured. Waiting for analysis results…
            </Text>
          ) : (
            <Text className={`mt-3 text-[12px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
              Once a photo is captured, a classification card will appear here with
              moss/algae detection results and confidence scores.
            </Text>
          )}
        </View>
      </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

export default ContainerAnalysisScreen;
