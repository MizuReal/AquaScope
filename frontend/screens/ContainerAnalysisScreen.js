import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Modal,
  TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import PredictButton from '../components/PredictButton';
import { useAppTheme } from '../utils/theme';
import { supabase } from '../utils/supabaseClient';
import {
  analyzeContainer,
  chatContainerWithGemini,
  getContainerCleaningSuggestion,
} from '../utils/api';

const SUPABASE_CONTAINER_SCANS_TABLE = process.env.EXPO_PUBLIC_SUPABASE_CONTAINER_SCANS_TABLE || 'container_scans';
const SUPABASE_CONTAINER_SCAN_BUCKET = process.env.EXPO_PUBLIC_SUPABASE_CONTAINER_SCAN_BUCKET || 'container-scans';

/* ── Helpers ────────────────────────────────────────────────── */

const CLASS_META = {
  Clean:      { color: '#22c55e', bgDark: '#14532d', bgLight: '#f0fdf4', label: 'Clean',          mcIcon: 'check-circle',       severity: 'safe' },
  LightMoss:  { color: '#facc15', bgDark: '#713f12', bgLight: '#fefce8', label: 'Light Moss',     mcIcon: 'alert-circle-outline', severity: 'low' },
  MediumMoss: { color: '#f97316', bgDark: '#7c2d12', bgLight: '#fff7ed', label: 'Medium Moss',    mcIcon: 'alert',              severity: 'moderate' },
  HeavyMoss:  { color: '#ef4444', bgDark: '#7f1d1d', bgLight: '#fff1f2', label: 'Heavy Moss',     mcIcon: 'close-circle',       severity: 'high' },
  Unknown:    { color: '#64748b', bgDark: '#1e293b', bgLight: '#f8fafc', label: 'Not Recognized', mcIcon: 'help-circle-outline', severity: 'unknown' },
};

const SEVERITY_BADGE = {
  safe:     { label: 'Safe',     textDark: 'text-emerald-300', textLight: 'text-emerald-700', borderDark: 'border-emerald-500/40', borderLight: 'border-emerald-300', bgDark: 'bg-emerald-900/30', bgLight: 'bg-emerald-50' },
  low:      { label: 'Low Risk', textDark: 'text-yellow-300',  textLight: 'text-yellow-700',  borderDark: 'border-yellow-500/40',  borderLight: 'border-yellow-300',  bgDark: 'bg-yellow-900/30',  bgLight: 'bg-yellow-50' },
  moderate: { label: 'Moderate', textDark: 'text-orange-300',  textLight: 'text-orange-700',  borderDark: 'border-orange-500/40',  borderLight: 'border-orange-300',  bgDark: 'bg-orange-900/30',  bgLight: 'bg-orange-50' },
  high:     { label: 'High Risk',textDark: 'text-red-300',     textLight: 'text-red-700',     borderDark: 'border-red-500/40',     borderLight: 'border-red-300',     bgDark: 'bg-red-900/30',     bgLight: 'bg-red-50' },
  unknown:  { label: 'Unknown',  textDark: 'text-slate-400',   textLight: 'text-slate-600',   borderDark: 'border-slate-700/40',   borderLight: 'border-slate-300',   bgDark: 'bg-slate-900/30',   bgLight: 'bg-slate-100' },
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
    <View className="mb-3">
      <View className="flex-row items-center justify-between mb-1">
        <Text className={`text-[12px] font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          {label}
        </Text>
        <Text
          style={{ color }}
          className="text-[12px] font-bold"
        >
          {pct}%
        </Text>
      </View>
      <View className={`h-2.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
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

const formatAdvisorText = (text = '') => {
  if (!text) return '';

  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/* ── Container chatbot card ───────────────────────────────── */

const ContainerChatCard = ({ result, isDark }) => {
  const [suggestion, setSuggestion] = useState(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef(null);

  useEffect(() => {
    if (!result || !result?.is_valid) {
      setSuggestion(null);
      setSuggestionError('');
      setSuggestionLoading(false);
      setChatHistory([]);
      return;
    }
    let cancelled = false;
    setSuggestion(null);
    setSuggestionError('');
    setSuggestionLoading(true);
    setChatHistory([]);

    getContainerCleaningSuggestion(result)
      .then((response) => {
        if (!cancelled) {
          setSuggestion(response?.suggestion || 'No suggestion available.');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSuggestionError(err?.message || 'Failed to get cleaning advice.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSuggestionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [result]);

  const handleSendChat = useCallback(async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatLoading || !result || !result?.is_valid) return;

    const nextHistory = [...chatHistory, { role: 'user', text: trimmed }];
    setChatHistory(nextHistory);
    setChatInput('');
    setChatLoading(true);

    try {
      const response = await chatContainerWithGemini(result, nextHistory, trimmed);
      setChatHistory((prev) => [...prev, { role: 'assistant', text: response?.reply || 'No reply.' }]);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', text: `Error: ${err?.message || 'Request failed'}` },
      ]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatScrollRef.current?.scrollToEnd?.({ animated: true }), 100);
    }
  }, [chatHistory, chatInput, chatLoading, result]);

  const sendEnabled = Boolean(result?.is_valid) && !chatLoading && chatInput.trim().length > 0;
  const classLabel = CLASS_META[result?.predicted_class || 'Unknown']?.label || result?.predicted_class || 'Unknown';

  return (
    <View
      className={`rounded-[24px] border p-5 ${
        isDark ? 'border-sky-900/60 bg-slate-950/50' : 'border-slate-200 bg-white'
      }`}
    >
      <View className="mb-2 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <MaterialCommunityIcons
            name="robot-outline"
            size={16}
            color={isDark ? '#7dd3fc' : '#0284c7'}
          />
          <Text
            className={`text-[11px] font-semibold uppercase tracking-widest ${
              isDark ? 'text-sky-300' : 'text-sky-700'
            }`}
          >
            Container advisor
          </Text>
        </View>
        <View className={`rounded-full border px-2 py-0.5 ${isDark ? 'border-sky-800/60' : 'border-sky-200'}`}>
          <Text className={`text-[9px] font-semibold ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
            AI
          </Text>
        </View>
      </View>

      <Text className={`mb-3 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
        Based on class: {classLabel}
      </Text>

      {suggestionLoading ? (
        <View className="items-center py-3">
          <ActivityIndicator size="small" color={isDark ? '#38bdf8' : '#0284c7'} />
          <Text className={`mt-2 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Generating cleaning guidance...
          </Text>
        </View>
      ) : suggestionError ? (
        <View>
          <Text className={`text-[11px] ${isDark ? 'text-red-300' : 'text-red-700'}`}>
            {suggestionError}
          </Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              setSuggestionError('');
              setSuggestionLoading(true);
              getContainerCleaningSuggestion(result)
                .then((response) => setSuggestion(response?.suggestion || 'No suggestion available.'))
                .catch((err) => setSuggestionError(err?.message || 'Failed to get cleaning advice.'))
                .finally(() => setSuggestionLoading(false));
            }}
            className={`mt-2 self-start rounded-full border px-3 py-1.5 ${
              isDark ? 'border-sky-700/50 bg-sky-900/30' : 'border-sky-300 bg-sky-50'
            }`}
          >
            <Text className={`text-[11px] font-semibold ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text className={`text-[12px] leading-[18px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          {formatAdvisorText(suggestion)}
        </Text>
      )}

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setChatOpen(true)}
        className={`mt-4 rounded-2xl border px-4 py-3 ${
          isDark ? 'border-slate-800/70 bg-slate-900/70' : 'border-slate-300 bg-slate-50'
        }`}
      >
        <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Ask how to clean, disinfect, or when to discard this container...
        </Text>
      </TouchableOpacity>

      <Modal
        visible={chatOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setChatOpen(false)}
      >
        <View className={`flex-1 px-5 py-10 ${isDark ? 'bg-black/70' : 'bg-slate-900/45'}`}>
          <View className="flex-1 justify-center">
            <View
              className={`max-h-[85%] rounded-[32px] border p-5 ${
                isDark ? 'border-sky-900/80 bg-slate-950/95' : 'border-sky-200 bg-white'
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className={`text-[16px] font-semibold ${isDark ? 'text-sky-50' : 'text-sky-900'}`}>
                    Container Copilot
                  </Text>
                  <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    Cleaning & disposal assistant
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close chat"
                  activeOpacity={0.8}
                  onPress={() => setChatOpen(false)}
                  className={`h-10 w-10 items-center justify-center rounded-full border ${
                    isDark ? 'border-slate-800/70' : 'border-slate-300'
                  }`}
                >
                  <Text className={`text-[16px] font-semibold ${isDark ? 'text-sky-100' : 'text-sky-900'}`}>
                    ✕
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                ref={chatScrollRef}
                className="mt-4"
                contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: 360 }}
              >
                {chatHistory.length === 0 && (
                  <Text className={`py-3 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
                    Ask for step-by-step cleaning and whether this container should be kept or replaced.
                  </Text>
                )}
                {chatHistory.map((msg, index) => (
                  <View
                    key={index}
                    className={
                      msg.role === 'user'
                        ? `self-end max-w-[85%] rounded-2xl border px-4 py-3 ${
                            isDark ? 'border-sky-500/30 bg-sky-500/15' : 'border-sky-300 bg-sky-100'
                          }`
                        : `self-start max-w-[85%] rounded-2xl border px-4 py-3 ${
                            isDark ? 'border-slate-800/80 bg-slate-900/80' : 'border-slate-200 bg-slate-100'
                          }`
                    }
                  >
                    <Text className={`text-[13px] leading-[18px] ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
                      {msg.role === 'assistant' ? formatAdvisorText(msg.text) : msg.text}
                    </Text>
                  </View>
                ))}
                {chatLoading && (
                  <View className="self-start flex-row items-center gap-2 px-3 py-2">
                    <ActivityIndicator size="small" color="#38bdf8" />
                    <Text className="text-[10px] text-sky-400">Thinking...</Text>
                  </View>
                )}
              </ScrollView>

              <View className="mt-4 flex-row items-center gap-3">
                <TextInput
                  className={`flex-1 rounded-2xl border px-4 py-3 ${
                    isDark
                      ? 'border-slate-800/70 bg-slate-900/80 text-sky-100'
                      : 'border-slate-300 bg-white text-slate-900'
                  }`}
                  placeholder="Ask about cleaning steps..."
                  placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                  value={chatInput}
                  onChangeText={setChatInput}
                  onSubmitEditing={handleSendChat}
                  returnKeyType="send"
                  editable={!chatLoading}
                  multiline
                  style={{ maxHeight: 80 }}
                />
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleSendChat}
                  className={
                    sendEnabled
                      ? `rounded-2xl border border-sky-400/60 px-4 py-3 ${
                          isDark ? 'bg-sky-500/80' : 'bg-sky-500/90'
                        }`
                      : `rounded-2xl px-4 py-3 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`
                  }
                  disabled={!sendEnabled}
                >
                  <Text
                    className={
                      sendEnabled
                        ? 'text-[13px] font-semibold text-slate-950'
                        : `text-[13px] font-semibold ${isDark ? 'text-slate-600' : 'text-slate-500'}`
                    }
                  >
                    Send
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
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
  // Holds the AbortController for the current in-flight classify request.
  // Calling .abort() cancels it cleanly when a new image is submitted before
  // the previous request finishes.
  const abortRef = useRef(null);

  const uploadContainerScanImage = useCallback(async (userId, asset) => {
    if (!userId || !asset?.uri) {
      return null;
    }

    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 720 } }],
        {
          compress: 0.55,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: false,
        }
      );

      const base64Data = await FileSystem.readAsStringAsync(manipulated.uri, {
        encoding: FileSystem.EncodingType?.Base64 || 'base64',
      });
      const fileBody = decode(base64Data);
      const filePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_CONTAINER_SCAN_BUCKET)
        .upload(filePath, fileBody, {
          contentType: 'image/jpeg',
        });

      if (uploadError) {
        console.warn('[Supabase] container image upload failed:', uploadError.message || uploadError);
        return null;
      }

      const { data: publicData } = supabase.storage
        .from(SUPABASE_CONTAINER_SCAN_BUCKET)
        .getPublicUrl(filePath);

      return publicData?.publicUrl || null;
    } catch (error) {
      console.warn('[Supabase] container image processing/upload error:', error?.message || error);
      return null;
    }
  }, []);

  const persistContainerScan = useCallback(async (analysis, asset) => {
    const sessionResult = await supabase.auth.getSession();
    const userId = sessionResult?.data?.session?.user?.id || null;
    if (!userId || !analysis) {
      return;
    }

    const uploadedImageUrl = await uploadContainerScanImage(userId, asset);

    const record = {
      user_id: userId,
      predicted_class: analysis?.predicted_class || 'Unknown',
      confidence: Number.isFinite(analysis?.confidence) ? analysis.confidence : null,
      is_valid: Boolean(analysis?.is_valid),
      rejection_reason: analysis?.rejection_reason || null,
      entropy: Number.isFinite(analysis?.entropy) ? analysis.entropy : null,
      margin: Number.isFinite(analysis?.margin) ? analysis.margin : null,
      probabilities:
        analysis?.probabilities && typeof analysis.probabilities === 'object'
          ? analysis.probabilities
          : {},
      image_uri: uploadedImageUrl,
    };

    const { error: insertError } = await supabase.from(SUPABASE_CONTAINER_SCANS_TABLE).insert(record);
    if (insertError) {
      console.warn('[Supabase] container scan insert failed:', insertError.message || insertError);
    }
  }, [uploadContainerScanImage]);

  const runAnalysisForAsset = useCallback(async (asset) => {
    setImage(asset);
    setResult(null);
    setLoading(true);
    setError('');

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const analysis = await analyzeContainer(asset, controller.signal);
      setResult(analysis);
      await persistContainerScan(analysis, asset);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError(err.message || 'Analysis failed.');
      }
    } finally {
      setLoading(false);
    }
  }, [persistContainerScan]);

  useFocusEffect(
    useCallback(() => {
      screenAnim.setValue(0);
      const animation = Animated.timing(screenAnim, {
        toValue: 1,
        duration: 320,
        delay: 0,
        useNativeDriver: true,
      });
      animation.start();

      return () => {
        animation.stop();
      };
    }, [screenAnim])
  );

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
    await runAnalysisForAsset(asset);
  };

  /* Gallery pick → classify */
  const handleUpload = async () => {
    setError('');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library access is required to upload images.');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: false,
    });

    if (pickerResult.canceled || !pickerResult.assets?.length) return;

    const asset = pickerResult.assets[0];
    await runAnalysisForAsset(asset);
  };

  /* Derive display data from result */
  const topClass = result?.predicted_class;
  const isValid = result?.is_valid ?? false;
  const rejectionReason = result?.rejection_reason ?? null;
  const meta = topClass ? (CLASS_META[topClass] || CLASS_META.Unknown) : null;
  const probabilities = result?.probabilities ?? {};
  const badge = meta ? SEVERITY_BADGE[meta.severity] : null;

  return (
    <KeyboardAvoidingView
      className={`flex-1 ${isDark ? 'bg-aquadark' : 'bg-slate-100'}`}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View
        style={{
          flex: 1,
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
        {/* ── Header ── */}
        <View className="px-5 pt-10 pb-4">
          <View className="mb-4 flex-row items-center justify-between">
            <TouchableOpacity
              activeOpacity={0.8}
              className={`h-9 w-9 items-center justify-center rounded-full border ${
                isDark ? 'border-sky-900/70 bg-slate-950/70' : 'border-slate-300 bg-white'
              }`}
              onPress={() => onNavigate && onNavigate('home')}
            >
              <Feather name="arrow-left" size={16} color={isDark ? '#e0f2fe' : '#1f2937'} />
            </TouchableOpacity>

            <View className="flex-row items-center gap-1.5">
              <View
                className={`h-2 w-2 rounded-full ${isDark ? 'bg-emerald-400' : 'bg-emerald-500'}`}
              />
              <Text
                className={`text-[11px] font-semibold uppercase tracking-widest ${
                  isDark ? 'text-slate-300' : 'text-slate-600'
                }`}
              >
                Ops Live
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-3">
            <View
              className={`h-10 w-10 items-center justify-center rounded-2xl border ${
                isDark ? 'border-sky-800/70 bg-slate-950/60' : 'border-sky-200 bg-sky-50'
              }`}
            >
              <MaterialCommunityIcons
                name="beaker-check-outline"
                size={20}
                color={isDark ? '#38bdf8' : '#0284c7'}
              />
            </View>
            <View>
              <Text
                className={`text-[20px] font-bold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}
              >
                Container Analysis
              </Text>
              <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Moss &amp; algae growth detection
              </Text>
            </View>
          </View>
        </View>

        <ScrollView
          className="px-5"
          contentContainerClassName="pb-28 gap-4"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Info strip ── */}
          <View
            className={`flex-row items-center gap-3 rounded-2xl border px-4 py-3 ${
              isDark
                ? 'border-sky-900/60 bg-sky-950/30'
                : 'border-sky-200 bg-sky-50'
            }`}
          >
            <MaterialCommunityIcons
              name="information-outline"
              size={16}
              color={isDark ? '#7dd3fc' : '#0284c7'}
            />
            <Text
              className={`flex-1 text-[12px] leading-[18px] ${
                isDark ? 'text-sky-200' : 'text-sky-800'
              }`}
            >
              Photograph the container surface in good lighting for the most accurate classification.
            </Text>
          </View>

          {/* ── Capture card ── */}
          <View
            className={`rounded-[24px] border ${
              isDark
                ? 'border-sky-900/70 bg-slate-950/70'
                : 'border-slate-300 bg-white'
            }`}
          >
            {/* card header */}
            <View
              className={`flex-row items-center gap-2 border-b px-5 py-4 ${
                isDark ? 'border-sky-900/50' : 'border-slate-100'
              }`}
            >
              <Feather name="camera" size={14} color={isDark ? '#38bdf8' : '#0284c7'} />
              <Text
                className={`text-[11px] font-semibold uppercase tracking-widest ${
                  isDark ? 'text-sky-300' : 'text-sky-600'
                }`}
              >
                Capture
              </Text>
            </View>

            <View className="gap-3 px-5 py-4">
              {/* Preview thumbnail (shown once an image is selected) */}
              {image && (
                <View
                  className={`overflow-hidden rounded-2xl border ${
                    isDark ? 'border-sky-900/70' : 'border-slate-200'
                  }`}
                  style={{ height: 180 }}
                >
                  <Image source={{ uri: image.uri }} className="h-full w-full" resizeMode="cover" />
                  {/* overlay label */}
                  <View className="absolute bottom-0 left-0 right-0 px-3 py-2"
                    style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
                  >
                    <View className="flex-row items-center gap-1.5">
                      <Feather name="image" size={11} color="#e0f2fe" />
                      <Text className="text-[11px] text-sky-100">Selected image</Text>
                    </View>
                  </View>
                </View>
              )}

              <PredictButton
                title={image ? 'Retake container photo' : 'Capture container photo'}
                onPress={handleCapture}
                disabled={loading}
              />

              <TouchableOpacity
                activeOpacity={0.8}
                disabled={loading}
                onPress={handleUpload}
                className={`flex-row items-center justify-center gap-2 rounded-2xl border px-4 py-3 ${
                  isDark
                    ? 'border-sky-800/60 bg-sky-900/20'
                    : 'border-sky-200 bg-sky-50'
                } ${loading ? 'opacity-40' : ''}`}
              >
                <Feather name="upload" size={14} color={isDark ? '#7dd3fc' : '#0369a1'} />
                <Text
                  className={`text-[13px] font-semibold ${
                    isDark ? 'text-sky-300' : 'text-sky-700'
                  }`}
                >
                  Upload from library
                </Text>
              </TouchableOpacity>

              {error ? (
                <View
                  className={`flex-row items-center gap-2 rounded-xl border px-3 py-2 ${
                    isDark ? 'border-red-800/50 bg-red-900/20' : 'border-red-200 bg-red-50'
                  }`}
                >
                  <Feather name="alert-circle" size={13} color={isDark ? '#fca5a5' : '#b91c1c'} />
                  <Text
                    className={`flex-1 text-[12px] ${isDark ? 'text-red-300' : 'text-red-700'}`}
                  >
                    {error}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* ── Analysis result card ── */}
          <View
            className={`rounded-[24px] border ${
              isDark
                ? 'border-sky-900/70 bg-slate-950/70'
                : 'border-slate-300 bg-white'
            }`}
          >
            {/* card header */}
            <View
              className={`flex-row items-center gap-2 border-b px-5 py-4 ${
                isDark ? 'border-sky-900/50' : 'border-slate-100'
              }`}
            >
              <MaterialCommunityIcons
                name="chart-donut"
                size={14}
                color={isDark ? '#38bdf8' : '#0284c7'}
              />
              <Text
                className={`text-[11px] font-semibold uppercase tracking-widest ${
                  isDark ? 'text-sky-300' : 'text-sky-600'
                }`}
              >
                Analysis snapshot
              </Text>
            </View>

            <View className="px-5 py-4">
              {/* ── Loading state ── */}
              {loading ? (
                <View className="items-center gap-3 py-8">
                  <View
                    className={`h-14 w-14 items-center justify-center rounded-full border ${
                      isDark
                        ? 'border-sky-800/60 bg-sky-900/30'
                        : 'border-sky-200 bg-sky-50'
                    }`}
                  >
                    <ActivityIndicator size="small" color={isDark ? '#38bdf8' : '#0284c7'} />
                  </View>
                  <Text
                    className={`text-[13px] font-medium ${
                      isDark ? 'text-sky-200' : 'text-sky-700'
                    }`}
                  >
                    Running moss classification…
                  </Text>
                  <Text
                    className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`}
                  >
                    This may take a few seconds
                  </Text>
                </View>

              ) : image && result ? (
                <View className="gap-4">
                  {/* ── Verdict row ── */}
                  <View className="flex-row gap-3">
                    {/* Thumbnail */}
                    <View
                      className={`overflow-hidden rounded-2xl border ${
                        isDark ? 'border-sky-900/60' : 'border-slate-200'
                      }`}
                      style={{ width: 88, height: 88 }}
                    >
                      <Image source={{ uri: image.uri }} className="h-full w-full" resizeMode="cover" />
                    </View>

                    {/* Verdict info */}
                    <View className="flex-1 gap-1.5">
                      {/* Class label + severity badge */}
                      <View className="flex-row items-center gap-2 flex-wrap">
                        <View
                          style={{ backgroundColor: `${meta?.color}22` }}
                          className="h-6 w-6 items-center justify-center rounded-full"
                        >
                          <MaterialCommunityIcons
                            name={meta?.mcIcon || 'help-circle-outline'}
                            size={16}
                            color={meta?.color || '#64748b'}
                          />
                        </View>
                        <Text
                          className={`text-[15px] font-bold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}
                        >
                          {meta?.label || topClass}
                        </Text>
                        {isValid && badge && (
                          <View
                            className={`rounded-full border px-2 py-0.5 ${
                              isDark
                                ? `${badge.borderDark} ${badge.bgDark}`
                                : `${badge.borderLight} ${badge.bgLight}`
                            }`}
                          >
                            <Text
                              className={`text-[10px] font-semibold ${
                                isDark ? badge.textDark : badge.textLight
                              }`}
                            >
                              {badge.label}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Confidence pill */}
                      {isValid && (
                        <View className="flex-row items-center gap-1.5">
                          <Feather
                            name="bar-chart-2"
                            size={12}
                            color={isDark ? '#94a3b8' : '#64748b'}
                          />
                          <Text
                            className={`text-[12px] font-semibold ${
                              isDark ? 'text-slate-300' : 'text-slate-600'
                            }`}
                          >
                            {Math.round(result.confidence * 100)}% confidence
                          </Text>
                        </View>
                      )}

                      {/* Entropy / margin */}
                      {isValid && (
                        <View className="flex-row items-center gap-1.5">
                          <MaterialCommunityIcons
                            name="sigma"
                            size={12}
                            color={isDark ? '#94a3b8' : '#64748b'}
                          />
                          <Text
                            className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}
                          >
                            Entropy {result.entropy ?? '--'} · Margin {result.margin != null ? Math.round(result.margin * 100) : '--'}%
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Rejection banner */}
                  {!isValid && (
                    <View className="gap-2">
                      <View
                        className={`flex-row items-start gap-2.5 rounded-2xl border px-4 py-3 ${
                          isDark
                            ? 'border-amber-700/40 bg-amber-900/20'
                            : 'border-amber-200 bg-amber-50'
                        }`}
                      >
                        <MaterialCommunityIcons
                          name="alert-circle-outline"
                          size={16}
                          color={isDark ? '#fcd34d' : '#b45309'}
                        />
                        <Text
                          className={`flex-1 text-[12px] leading-[18px] ${
                            isDark ? 'text-amber-200' : 'text-amber-800'
                          }`}
                        >
                          {rejectionReason || 'Image not recognized as a container'}
                        </Text>
                      </View>

                      <View
                        className={`flex-row items-start gap-2.5 rounded-2xl border px-4 py-3 ${
                          isDark
                            ? 'border-slate-700/50 bg-slate-900/40'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <MaterialCommunityIcons
                          name="robot-off-outline"
                          size={16}
                          color={isDark ? '#94a3b8' : '#64748b'}
                        />
                        <Text
                          className={`flex-1 text-[12px] leading-[18px] ${
                            isDark ? 'text-slate-300' : 'text-slate-700'
                          }`}
                        >
                          AI advisor is unavailable until a valid container is recognized.
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Severity note */}
                  {severityNote(topClass, isValid) ? (
                    <View
                      className={`flex-row items-start gap-2.5 rounded-2xl border px-4 py-3 ${
                        isDark
                          ? 'border-sky-900/50 bg-sky-950/30'
                          : 'border-sky-100 bg-sky-50'
                      }`}
                    >
                      <Feather
                        name="info"
                        size={13}
                        color={isDark ? '#7dd3fc' : '#0369a1'}
                      />
                      <Text
                        className={`flex-1 text-[12px] leading-[18px] ${
                          isDark ? 'text-sky-200' : 'text-sky-800'
                        }`}
                      >
                        {severityNote(topClass, isValid)}
                      </Text>
                    </View>
                  ) : null}

                  {/* Combine-data note */}
                  {isValid && (
                    <View className="flex-row items-center gap-2">
                      <MaterialCommunityIcons
                        name="link-variant"
                        size={12}
                        color={isDark ? '#64748b' : '#94a3b8'}
                      />
                      <Text
                        className={`flex-1 text-[11px] ${
                          isDark ? 'text-slate-500' : 'text-slate-400'
                        }`}
                      >
                        Combine with pH, turbidity and nutrient data for a full assessment.
                      </Text>
                    </View>
                  )}

                  {/* Confidence breakdown bars */}
                  {isValid && (
                    <View
                      className={`rounded-2xl border p-4 ${
                        isDark
                          ? 'border-sky-900/50 bg-slate-900/50'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <View className="mb-3 flex-row items-center gap-2">
                        <MaterialCommunityIcons
                          name="chart-bar"
                          size={13}
                          color={isDark ? '#38bdf8' : '#0284c7'}
                        />
                        <Text
                          className={`text-[11px] font-semibold uppercase tracking-widest ${
                            isDark ? 'text-sky-300' : 'text-sky-600'
                          }`}
                        >
                          Confidence breakdown
                        </Text>
                      </View>
                      {Object.entries(CLASS_META)
                        .filter(([cls]) => cls !== 'Unknown')
                        .map(([cls, { color, label }]) => (
                          <ConfidenceBar
                            key={cls}
                            label={label}
                            value={probabilities[cls] ?? 0}
                            color={color}
                            isDark={isDark}
                          />
                        ))}
                    </View>
                  )}

                  {isValid ? <ContainerChatCard result={result} isDark={isDark} /> : null}
                </View>

              ) : image && !result ? (
                /* ── Pending state (image picked, no result yet) ── */
                <View className="flex-row items-center gap-3 py-6">
                  <MaterialCommunityIcons
                    name="image-search-outline"
                    size={22}
                    color={isDark ? '#475569' : '#94a3b8'}
                  />
                  <Text className={`text-[13px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                    Image captured. Waiting for analysis results…
                  </Text>
                </View>

              ) : (
                /* ── Empty state ── */
                <View className="items-center gap-3 py-8">
                  <View
                    className={`h-14 w-14 items-center justify-center rounded-full border ${
                      isDark
                        ? 'border-slate-800/70 bg-slate-900/50'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <MaterialCommunityIcons
                      name="beaker-outline"
                      size={24}
                      color={isDark ? '#475569' : '#94a3b8'}
                    />
                  </View>
                  <Text
                    className={`text-[13px] font-medium ${
                      isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    No image analyzed yet
                  </Text>
                  <Text
                    className={`max-w-[260px] text-center text-[12px] leading-[18px] ${
                      isDark ? 'text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    Capture or upload a photo to see moss/algae classification results and confidence scores.
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* ── Tips card ── */}
          <View
            className={`rounded-[24px] border p-5 ${
              isDark ? 'border-sky-900/60 bg-slate-950/50' : 'border-slate-200 bg-white'
            }`}
          >
            <View className="mb-3 flex-row items-center gap-2">
              <Feather name="zap" size={13} color={isDark ? '#facc15' : '#b45309'} />
              <Text
                className={`text-[11px] font-semibold uppercase tracking-widest ${
                  isDark ? 'text-yellow-300' : 'text-amber-700'
                }`}
              >
                Capture tips
              </Text>
            </View>
            {[
              { icon: 'sun',        text: 'Shoot in natural light or brightly lit area' },
              { icon: 'maximize-2', text: 'Fill the frame with the container surface' },
              { icon: 'droplet',    text: 'Dry the surface before photographing when possible' },
              { icon: 'refresh-cw', text: 'Retake if the image is blurry or poorly lit' },
            ].map((tip) => (
              <View key={tip.text} className="mb-2.5 flex-row items-start gap-2.5">
                <View
                  className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md ${
                    isDark ? 'bg-slate-800' : 'bg-slate-100'
                  }`}
                >
                  <Feather name={tip.icon} size={11} color={isDark ? '#94a3b8' : '#64748b'} />
                </View>
                <Text
                  className={`flex-1 text-[12px] leading-[18px] ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {tip.text}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

export default ContainerAnalysisScreen;
