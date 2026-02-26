import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Image,
  Animated,
  Easing,
  Modal,
  Dimensions,
  ActivityIndicator,
  LayoutAnimation,
  UIManager,
  StyleSheet,
} from 'react-native';

// Enable LayoutAnimation on Android
if (UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { Camera, CameraView } from 'expo-camera';
import { Accelerometer } from 'expo-sensors';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import InputField from '../components/InputField';
import PredictButton from '../components/PredictButton';
import { uploadDataCardForOCR, validateFiducials, submitWaterSample } from '../utils/api';
import { supabase } from '../utils/supabaseClient';
import WaterResultScreen from './WaterResultScreen';
import { useAppTheme } from '../utils/theme';

const colorOptions = ['Clear', 'Slightly tinted', 'Yellow-brown', 'Greenish'];
const sourceOptions = ['Surface water', 'Groundwater', 'Treated supply', 'Industrial effluent', 'Agricultural runoff'];

const numericFormFields = [
  'pH',
  'hardness',
  'solids',
  'chloramines',
  'sulfate',
  'conductivity',
  'organicCarbon',
  'trihalomethanes',
  'turbidity',
  'freeChlorineResidual',
];

const parseNumericInput = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const canonicalizeFieldKey = (key = '') => key.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const backendFieldAliasMap = {
  ph: 'pH',
  hydrogenion: 'pH',
  hardness: 'hardness',
  totalhardness: 'hardness',
  solids: 'solids',
  totaldissolvedsolids: 'solids',
  tds: 'solids',
  chloramines: 'chloramines',
  sulfate: 'sulfate',
  sulphate: 'sulfate',
  conductivity: 'conductivity',
  electricalconductivity: 'conductivity',
  organiccarbon: 'organicCarbon',
  toc: 'organicCarbon',
  totalorganiccarbon: 'organicCarbon',
  trihalomethanes: 'trihalomethanes',
  thm: 'trihalomethanes',
  turbidity: 'turbidity',
  freechlorineresidual: 'freeChlorineResidual',
  freechlorine: 'freeChlorineResidual',
  residualchlorine: 'freeChlorineResidual',
};

const resolveOcrFieldKey = (key) => backendFieldAliasMap[canonicalizeFieldKey(key ?? '')];

const orientationRotationMap = {
  1: 0,
  3: 180,
  6: 90,
  8: -90,
};

const WATER_CARD_ASPECT = 1080 / 1240;
const WINDOW_DIMENSIONS = Dimensions.get('window');
const MAX_GUIDE_WIDTH = WINDOW_DIMENSIONS.width - 32;
const MAX_GUIDE_HEIGHT = WINDOW_DIMENSIONS.height * 0.78;
const CAPTURE_GUIDE_WIDTH = Math.min(MAX_GUIDE_WIDTH, MAX_GUIDE_HEIGHT * WATER_CARD_ASPECT);
const CAPTURE_GUIDE_HEIGHT = CAPTURE_GUIDE_WIDTH / WATER_CARD_ASPECT;
const SUPABASE_SAMPLES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_SAMPLES_TABLE || 'field_samples';
const SUPABASE_PROFILES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_PROFILES_TABLE || 'profiles';
const SUPABASE_AVATAR_BUCKET = process.env.EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET || 'avatars';
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const AUTO_CAPTURE_START_THRESHOLD = 0.55; // Lower threshold - fiducials are the main check
const AUTO_CAPTURE_CANCEL_THRESHOLD = 0.35;
const AUTO_CAPTURE_START_MS = 1200; // Faster capture once ready
const MAX_ACCEL_DELTA = 0.35;
const FIDUCIAL_CHECK_INTERVAL_MS = 450; // Check more frequently
const MIN_FIDUCIALS_FOR_CAPTURE = 4; // Require all 4 corners
const FLOATING_TAB_BAR_CLEARANCE = 120;

const normalizeAvatarUrl = (value) => {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:image/')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (!SUPABASE_URL) return trimmed;
  if (trimmed.startsWith('/storage/')) return `${SUPABASE_URL}${trimmed}`;
  if (trimmed.startsWith('storage/')) return `${SUPABASE_URL}/${trimmed}`;
  if (trimmed.startsWith(`${SUPABASE_AVATAR_BUCKET}/`)) {
    return `${SUPABASE_URL}/storage/v1/object/public/${trimmed}`;
  }
  if (!trimmed.includes('/')) {
    return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_AVATAR_BUCKET}/${trimmed}`;
  }
  if (trimmed.startsWith('/')) return `${SUPABASE_URL}${trimmed}`;
  return trimmed;
};

const withAvatarVersion = (value) => {
  if (!value) return '';
  return `${value}${value.includes('?') ? '&' : '?'}v=${Date.now()}`;
};

const getInitials = (value) => {
  if (!value) return 'NA';
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NA';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return `${first}${last}`.toUpperCase();
};

const formatElapsedLabel = (timestamp) => {
  if (!timestamp) return 'timestamp unavailable';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'timestamp unavailable';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const getGreetingLabel = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const deriveAlignmentScore = ({ x = 0, y = 0, z = 0 }) => {
  const magnitude = Math.max(1e-3, Math.sqrt(x * x + y * y + z * z));
  const normX = x / magnitude;
  const normY = y / magnitude;
  const normZ = z / magnitude;
  const gravityDrift = Math.min(1, Math.abs(magnitude - 1));
  const tiltPenalty = Math.min(1, Math.abs(Math.abs(normZ) - 1));
  const lateralMotion = Math.min(1, Math.sqrt(normX * normX + normY * normY));
  const score = 1 - (0.5 * tiltPenalty + 0.3 * gravityDrift + 0.2 * lateralMotion);
  return Math.max(0, Math.min(1, score));
};

const computeJitterPenalty = (previousSample, currentSample) => {
  if (!previousSample || !currentSample) {
    return 0;
  }
  const dx = (currentSample.x || 0) - (previousSample.x || 0);
  const dy = (currentSample.y || 0) - (previousSample.y || 0);
  const dz = (currentSample.z || 0) - (previousSample.z || 0);
  const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Math.min(1, delta / MAX_ACCEL_DELTA);
};

const preprocessImage = async (asset) => {
  if (!asset?.uri) {
    return asset;
  }

  const steps = [];
  const options = { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG };
  let workingUri = asset.uri;
  let currentWidth = asset.width;
  let currentHeight = asset.height;

  const orientation = asset.exif?.Orientation;
  const rotation = orientationRotationMap[orientation] || 0;
  if (rotation) {
    const rotated = await ImageManipulator.manipulateAsync(workingUri, [{ rotate: rotation }], options);
    workingUri = rotated.uri;
    currentWidth = rotated.width;
    currentHeight = rotated.height;
    steps.push(`orientation +${rotation}°`);
  }

  const targetEdge = 1600;
  const longestEdge = Math.max(currentWidth || 0, currentHeight || 0);
  if (longestEdge > targetEdge) {
    const resizeAction =
      (currentWidth || 0) >= (currentHeight || 0)
        ? { width: targetEdge }
        : { height: targetEdge };
    const resized = await ImageManipulator.manipulateAsync(workingUri, [{ resize: resizeAction }], options);
    workingUri = resized.uri;
    currentWidth = resized.width;
    currentHeight = resized.height;
    steps.push(`downscale → ${Math.round(Math.max(currentWidth, currentHeight))}px`);
  }

  if (currentWidth && currentHeight) {
    const marginX = Math.round(currentWidth * 0.025);
    const marginY = Math.round(currentHeight * 0.025);
    const cropWidth = currentWidth - marginX * 2;
    const cropHeight = currentHeight - marginY * 2;
    if (cropWidth > 0 && cropHeight > 0) {
      const cropped = await ImageManipulator.manipulateAsync(
        workingUri,
        [
          {
            crop: {
              originX: marginX,
              originY: marginY,
              width: cropWidth,
              height: cropHeight,
            },
          },
        ],
        options
      );
      workingUri = cropped.uri;
      currentWidth = cropped.width;
      currentHeight = cropped.height;
      steps.push('trim 5% border');
    }
  }

  return {
    ...asset,
    uri: workingUri,
    width: currentWidth,
    height: currentHeight,
    _preprocessSteps: steps,
  };
};

// ---------------------------------------------------------------------------
// CollapsibleSection — animated accordion card for parameter groups
// ---------------------------------------------------------------------------
const CollapsibleSection = ({ title, icon, fieldCount, filledCount, isDark, children, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const chevronAnim = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 260,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
    const next = !expanded;
    setExpanded(next);
    Animated.timing(chevronAnim, {
      toValue: next ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [expanded, chevronAnim]);

  const spin = chevronAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const allFilled = fieldCount > 0 && filledCount === fieldCount;
  const someFilled = filledCount > 0 && !allFilled;
  const iconColor = allFilled ? '#10b981' : someFilled ? '#f59e0b' : isDark ? '#475569' : '#94a3b8';
  const iconBg = allFilled
    ? isDark ? 'rgba(16,185,129,0.15)' : '#d1fae5'
    : someFilled
    ? isDark ? 'rgba(245,158,11,0.15)' : '#fef3c7'
    : isDark ? 'rgba(30,41,59,0.8)' : '#f8fafc';

  return (
    <View
      style={{ borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: isDark ? 'rgba(14,165,233,0.18)' : '#e2e8f0' }}
      className={isDark ? 'bg-slate-950/80' : 'bg-white'}
    >
      {/* Header row — always visible */}
      <TouchableOpacity activeOpacity={0.78} onPress={toggle} className="px-5 py-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row flex-1 items-center gap-3">
            <View style={{ width: 32, height: 32, borderRadius: 12, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name={icon} size={15} color={iconColor} />
            </View>
            <View className="flex-1">
              <Text className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                {title}
              </Text>
              {!expanded && (
                <Text className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  {filledCount === 0
                    ? 'Tap to enter values manually'
                    : `${filledCount} of ${fieldCount} field${fieldCount !== 1 ? 's' : ''} filled`}
                </Text>
              )}
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            {filledCount > 0 && (
              <View
                style={{
                  borderRadius: 99,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  backgroundColor: allFilled
                    ? isDark ? 'rgba(16,185,129,0.18)' : '#d1fae5'
                    : isDark ? 'rgba(245,158,11,0.18)' : '#fef3c7',
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '700',
                    color: allFilled
                      ? isDark ? '#6ee7b7' : '#065f46'
                      : isDark ? '#fcd34d' : '#92400e',
                  }}
                >
                  {filledCount}/{fieldCount}
                </Text>
              </View>
            )}
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Feather name="chevron-down" size={16} color={isDark ? '#38bdf8' : '#0284c7'} />
            </Animated.View>
          </View>
        </View>
      </TouchableOpacity>

      {/* Collapsible content */}
      {expanded && (
        <View
          style={{ borderTopWidth: 1, borderTopColor: isDark ? 'rgba(14,165,233,0.1)' : '#f1f5f9' }}
          className="px-5 pb-5 pt-2"
        >
          {children}
        </View>
      )}
    </View>
  );
};

const DataInputScreen = ({ onNavigate }) => {
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState({
    pH: '',
    hardness: '',
    solids: '',
    chloramines: '',
    sulfate: '',
    conductivity: '',
    organicCarbon: '',
    trihalomethanes: '',
    turbidity: '',
    freeChlorineResidual: '',
    color: 'Clear',
    source: 'Surface water',
  });
  const [capturePreview, setCapturePreview] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [ocrApplied, setOcrApplied] = useState(false);
  const [preprocessing, setPreprocessing] = useState(false);
  const [preprocessNotes, setPreprocessNotes] = useState('');
  const [cameraVisible, setCameraVisible] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [alignmentScore, setAlignmentScore] = useState(0);
  const [alignmentStatus, setAlignmentStatus] = useState('');
  const [autoCaptureCountdown, setAutoCaptureCountdown] = useState(0);
  const [predictionResult, setPredictionResult] = useState(null);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [profileName, setProfileName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [sessionUserId, setSessionUserId] = useState('');
  const [latestSampleLabel, setLatestSampleLabel] = useState('No sample yet');
  const [latestSampleMeta, setLatestSampleMeta] = useState('Capture your first water card');
  const [todaySamplesCount, setTodaySamplesCount] = useState(0);
  const [totalSamplesCount, setTotalSamplesCount] = useState(0);
  // Fiducial detection state
  const [fiducialCount, setFiducialCount] = useState(0);
  const [fiducialQuality, setFiducialQuality] = useState(0);
  const [fiducialReady, setFiducialReady] = useState(false);
  const spinnerValue = useRef(new Animated.Value(0)).current;
  const spinnerLoop = useRef(null);
  const cameraRef = useRef(null);
  const heroAnim = useRef(new Animated.Value(0)).current;
  const sectionsAnim = useRef(new Animated.Value(0)).current;
  const accelerometerSubscriptionRef = useRef(null);
  const autoCaptureTimerRef = useRef(null);
  const autoCaptureLockRef = useRef(false);
  const lastAccelSampleRef = useRef(null);
  // Fiducial validation refs
  const fiducialCheckIntervalRef = useRef(null);
  const fiducialCheckInProgressRef = useRef(false);

  const refreshProfileOnly = useCallback(async (sessionUser = null) => {
    try {
      let user = sessionUser;
      if (!user) {
        const sessionResult = await supabase.auth.getSession();
        user = sessionResult?.data?.session?.user || null;
      }

      if (!user?.id) {
        setSessionUserId('');
        setProfileName('');
        setAvatarUrl('');
        return;
      }

      setSessionUserId(user.id);
      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select('display_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();

      if (profileResult.error && profileResult.error.code !== 'PGRST116') {
        console.warn('[Supabase] datainput profile refresh failed:', profileResult.error.message || profileResult.error);
        return;
      }

      setProfileName(profileResult.data?.display_name || user.email || '');
      setAvatarUrl(withAvatarVersion(normalizeAvatarUrl(profileResult.data?.avatar_url)));
    } catch (error) {
      console.warn('[Supabase] datainput profile refresh error:', error?.message || error);
    }
  }, []);

  const clearAutoCaptureTimer = useCallback(
    (preserveLock = false) => {
      if (autoCaptureTimerRef.current) {
        clearInterval(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
      // Clear fiducial check interval
      if (fiducialCheckIntervalRef.current) {
        clearInterval(fiducialCheckIntervalRef.current);
        fiducialCheckIntervalRef.current = null;
      }
      fiducialCheckInProgressRef.current = false;
      if (!preserveLock) {
        autoCaptureLockRef.current = false;
      }
      setAutoCaptureCountdown(0);
    },
    []
  );

  const stopAlignmentMonitoring = useCallback(() => {
    accelerometerSubscriptionRef.current?.remove?.();
    accelerometerSubscriptionRef.current = null;
    lastAccelSampleRef.current = null;
    // Reset fiducial state
    if (fiducialCheckIntervalRef.current) {
      clearInterval(fiducialCheckIntervalRef.current);
      fiducialCheckIntervalRef.current = null;
    }
    fiducialCheckInProgressRef.current = false;
    setFiducialCount(0);
    setFiducialQuality(0);
    setFiducialReady(false);
  }, []);

  useEffect(() => {
    if (ocrLoading) {
      spinnerLoop.current?.stop();
      spinnerLoop.current = Animated.loop(
        Animated.timing(spinnerValue, {
          toValue: 1,
          duration: 1100,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      spinnerLoop.current.start();
    } else {
      spinnerLoop.current?.stop();
      spinnerValue.setValue(0);
    }

    return () => {
      spinnerLoop.current?.stop();
    };
  }, [ocrLoading, spinnerValue]);

  useFocusEffect(
    useCallback(() => {
      heroAnim.setValue(0);
      sectionsAnim.setValue(0);

      const animation = Animated.stagger(70, [
        Animated.timing(heroAnim, {
          toValue: 1,
          duration: 320,
          delay: 0,
          useNativeDriver: true,
        }),
        Animated.timing(sectionsAnim, {
          toValue: 1,
          duration: 320,
          delay: 0,
          useNativeDriver: true,
        }),
      ]);

      animation.start();

      return () => {
        animation.stop();
      };
    }, [heroAnim, sectionsAnim])
  );

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        const sessionResult = await supabase.auth.getSession();
        const user = sessionResult?.data?.session?.user || null;
        if (!user) {
          if (isMounted) {
            setSessionUserId('');
            setProfileName('');
            setAvatarUrl('');
          }
          return;
        }

        if (isMounted) {
          setSessionUserId(user.id);
        }

        const { data, error } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select('display_name, avatar_url')
          .eq('id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.warn('[Supabase] profile fetch failed:', error.message || error);
        }

        if (isMounted) {
          setProfileName(data?.display_name || user.email || '');
          setAvatarUrl(withAvatarVersion(normalizeAvatarUrl(data?.avatar_url)));
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const [latestResult, totalCountResult, todayCountResult] = await Promise.all([
          supabase
            .from(SUPABASE_SAMPLES_TABLE)
            .select('id, created_at, sample_label, source')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from(SUPABASE_SAMPLES_TABLE)
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          supabase
            .from(SUPABASE_SAMPLES_TABLE)
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('created_at', startOfDay.toISOString()),
        ]);

        const latest = latestResult?.data || null;
        if (isMounted) {
          setLatestSampleLabel(latest?.sample_label || latest?.source || 'No sample yet');
          setLatestSampleMeta(
            latest?.id
              ? `ID #${String(latest.id).slice(0, 8)} · ${formatElapsedLabel(latest.created_at)}`
              : 'Capture your first water card'
          );
          setTotalSamplesCount(totalCountResult?.count || 0);
          setTodaySamplesCount(todayCountResult?.count || 0);
        }
      } catch (error) {
        console.warn('[Supabase] profile fetch error:', error?.message || error);
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshProfileOnly();
    }, [refreshProfileOnly])
  );

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      refreshProfileOnly(session?.user || null);
    });

    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, [refreshProfileOnly]);

  useEffect(() => {
    if (!sessionUserId) return undefined;

    const profileChannel = supabase
      .channel(`datainput-profile-sync-${sessionUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: SUPABASE_PROFILES_TABLE,
          filter: `id=eq.${sessionUserId}`,
        },
        () => {
          refreshProfileOnly();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [refreshProfileOnly, sessionUserId]);

  // Fiducial validation function - captures a frame and sends to backend for validation
  const checkFiducials = useCallback(async () => {
    if (!cameraRef.current || !cameraReady || fiducialCheckInProgressRef.current || autoCaptureLockRef.current) {
      return;
    }
    fiducialCheckInProgressRef.current = true;
    try {
      // Take a snapshot for corner detection (good quality for reliable detection)
      const snapshot = await cameraRef.current.takePictureAsync({
        quality: 0.75,  // Higher quality for better corner detection
        base64: false,
        exif: false,
        skipProcessing: false,  // Allow processing for better image
      });
      if (!snapshot?.uri) {
        return;
      }
      const result = await validateFiducials(snapshot);
      setFiducialCount(result.detected || 0);
      setFiducialQuality(result.quality || 0);
      setFiducialReady(result.ready || false);
      console.debug('[fiducial] Validation result:', result);
    } catch (error) {
      console.debug('[fiducial] Check failed:', error?.message);
    } finally {
      fiducialCheckInProgressRef.current = false;
    }
  }, [cameraReady]);

  useEffect(() => {
    if (!cameraVisible) {
      stopAlignmentMonitoring();
      clearAutoCaptureTimer();
      setAlignmentScore(0);
      setAlignmentStatus('');
      setFiducialCount(0);
      setFiducialQuality(0);
      setFiducialReady(false);
      lastAccelSampleRef.current = null;
      return;
    }
    Accelerometer.setUpdateInterval(150);
    accelerometerSubscriptionRef.current = Accelerometer.addListener((data) => {
      const baseScore = deriveAlignmentScore(data);
      const jitterPenalty = computeJitterPenalty(lastAccelSampleRef.current, data) * 0.45;
      lastAccelSampleRef.current = data;
      const composite = Math.max(0, Math.min(1, baseScore - jitterPenalty));
      setAlignmentScore((prev) => (Number.isFinite(prev) ? prev * 0.55 + composite * 0.45 : composite));
    });
    
    // Start periodic fiducial checks
    fiducialCheckIntervalRef.current = setInterval(() => {
      if (cameraReady && !autoCaptureLockRef.current) {
        checkFiducials();
      }
    }, FIDUCIAL_CHECK_INTERVAL_MS);
    
    return () => {
      stopAlignmentMonitoring();
      clearAutoCaptureTimer();
      setAlignmentScore(0);
      setAlignmentStatus('');
      setFiducialCount(0);
      setFiducialQuality(0);
      setFiducialReady(false);
      lastAccelSampleRef.current = null;
    };
  }, [cameraVisible, cameraReady, clearAutoCaptureTimer, stopAlignmentMonitoring, checkFiducials]);

  const spinnerRotation = spinnerValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const ensureCameraPermission = useCallback(async () => {
    try {
      const current = await Camera.getCameraPermissionsAsync();
      if (current.status === 'granted') {
        return true;
      }
      const requested = await Camera.requestCameraPermissionsAsync();
      if (requested.status === 'granted') {
        return true;
      }
    } catch (error) {
      console.error('Camera permission error:', error);
    }
    setCameraError('Camera access is required to capture parameter cards.');
    return false;
  }, []);

  const handlePhotoResult = useCallback(async (asset) => {
    if (!asset) return;
    setPreprocessNotes('');
    setPreprocessing(true);
    try {
      const previewAsset = await preprocessImage(asset);
      setCapturePreview(previewAsset);
      if (previewAsset?._preprocessSteps?.length) {
        setPreprocessNotes(`Preview normalized (${previewAsset._preprocessSteps.join(', ')})`);
      } else {
        setPreprocessNotes('Capture preview used as-is (already aligned).');
      }
      await processCaptureWithOCR(previewAsset || asset);
    } catch (error) {
      console.error('Preprocessing failed:', error);
      setCameraError('Failed to normalize capture for OCR. Try again.');
    } finally {
      setPreprocessing(false);
    }
  }, [processCaptureWithOCR]);

  const handleOpenCamera = useCallback(async () => {
    setCameraError('');
    setOcrError('');
    setOcrApplied(false);
    setPreprocessNotes('');
    setPreprocessing(false);
    clearAutoCaptureTimer();
    setAlignmentScore(0);
    setAlignmentStatus('');
    const granted = await ensureCameraPermission();
    if (!granted) return;
    setCameraReady(false);
    setCameraVisible(true);
  }, [clearAutoCaptureTimer, ensureCameraPermission]);

  const handleCloseCamera = useCallback(() => {
    setCameraVisible(false);
    setCameraReady(false);
    stopAlignmentMonitoring();
    clearAutoCaptureTimer();
    setAlignmentScore(0);
    setAlignmentStatus('');
    setAutoCaptureCountdown(0);
    autoCaptureLockRef.current = false;
  }, [clearAutoCaptureTimer, stopAlignmentMonitoring]);

  const handleTakePhoto = useCallback(
    async (autoTriggered = false) => {
      if (!cameraRef.current) return;
      if (!cameraReady) {
        setCameraError('Camera is still focusing. Hold steady.');
        return;
      }
      if (!autoTriggered) {
        clearAutoCaptureTimer();
      }
      console.debug('[capture] takePicture invoked', { autoTriggered });
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.9,
          base64: false,
          exif: true,
          skipProcessing: true,
        });
        handleCloseCamera();
        await handlePhotoResult(photo);
      } catch (error) {
        console.error('Capture failed:', error);
        setCameraError(`Unable to capture photo: ${error?.message || 'Unknown error'}`);
        handleCloseCamera();
      } finally {
        autoCaptureLockRef.current = false;
        clearAutoCaptureTimer();
      }
    },
    [cameraReady, clearAutoCaptureTimer, handleCloseCamera, handlePhotoResult]
  );

  useEffect(() => {
    if (!cameraVisible) {
      setAlignmentStatus('Camera closed');
      clearAutoCaptureTimer();
      return;
    }
    if (!cameraReady) {
      setAlignmentStatus('Focusing camera…');
      clearAutoCaptureTimer();
      return;
    }
    if (!autoCaptureEnabled) {
      setAlignmentStatus('Auto capture disabled');
      clearAutoCaptureTimer();
      return;
    }
    if (autoCaptureLockRef.current) {
      setAlignmentStatus('Capturing…');
      return;
    }
    
    // NEW: Require fiducial detection for auto-capture (like QR code scanning)
    const fiducialsOk = fiducialCount >= MIN_FIDUCIALS_FOR_CAPTURE && fiducialReady;
    const stabilityOk = alignmentScore >= AUTO_CAPTURE_START_THRESHOLD;
    const bothConditionsMet = fiducialsOk && stabilityOk;
    
    // Generate status message based on what's missing
    let statusMessage = '';
    if (fiducialCount === 0) {
      statusMessage = 'Position the form — looking for corner markers…';
    } else if (fiducialCount < MIN_FIDUCIALS_FOR_CAPTURE) {
      statusMessage = `Found ${fiducialCount}/4 corners — adjust position`;
    } else if (!fiducialReady) {
      statusMessage = `All corners found — improve alignment (${Math.round(fiducialQuality * 100)}%)`;
    } else if (!stabilityOk) {
      statusMessage = 'Corners detected ✓ — hold steady';
    } else {
      statusMessage = 'All corners detected ✓ — auto capture arming';
    }
    
    if (bothConditionsMet && !autoCaptureTimerRef.current) {
      console.debug('[capture] Fiducials ready + alignment stable, starting countdown', {
        fiducialCount,
        fiducialQuality,
        alignmentScore,
      });
      setAlignmentStatus('All corners detected ✓ — capturing soon');
      const started = Date.now();
      setAutoCaptureCountdown(AUTO_CAPTURE_START_MS);
      autoCaptureTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - started;
        const remaining = Math.max(0, AUTO_CAPTURE_START_MS - elapsed);
        setAutoCaptureCountdown(remaining);
        if (remaining <= 0) {
          console.debug('[capture] auto capture firing');
          clearAutoCaptureTimer(true);
          autoCaptureLockRef.current = true;
          handleTakePhoto(true);
        }
      }, 120);
    } else if (!bothConditionsMet) {
      // Cancel countdown if conditions are no longer met
      if (autoCaptureTimerRef.current) {
        console.debug('[capture] Conditions lost, cancelling countdown', {
          fiducialCount,
          fiducialReady,
          alignmentScore,
        });
        clearAutoCaptureTimer();
      }
      setAlignmentStatus(statusMessage);
    } else {
      setAlignmentStatus(statusMessage);
    }
  }, [
    alignmentScore,
    autoCaptureEnabled,
    cameraReady,
    cameraVisible,
    clearAutoCaptureTimer,
    handleTakePhoto,
    fiducialCount,
    fiducialQuality,
    fiducialReady,
  ]);

  const cameraModal = (
    <Modal
      visible={cameraVisible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={handleCloseCamera}
    >
      <View className="flex-1 bg-black">
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          facing="back"
          ratio="4:3"
          enableTorch={torchEnabled}
          onCameraReady={() => setCameraReady(true)}
        />
        <View className="pointer-events-none absolute inset-0">
          <View className="flex-1 items-center justify-center px-4">
            <View
              className="rounded-[32px] border-2 border-emerald-300/80 bg-black/45"
              style={{ width: CAPTURE_GUIDE_WIDTH, height: CAPTURE_GUIDE_HEIGHT }}
            >
              <View className="absolute inset-4 rounded-[28px] border border-dashed border-emerald-200/70" />
              <View className="absolute inset-x-6 top-5 h-[3px] rounded-full bg-emerald-200/70" />
              <View className="absolute inset-x-6 bottom-5 h-[3px] rounded-full bg-emerald-200/70" />
            </View>
          </View>
          <View className="absolute top-12 w-full items-center px-6">
            <Text className="text-center text-[16px] font-semibold text-emerald-50">
              Align the card within the frame
            </Text>
            <Text className="mt-1 text-center text-[12px] text-emerald-100/80">
              Fill the tall frame, keep all four fiducial squares visible, and avoid glare.
            </Text>
          </View>
          <View
            className="absolute inset-x-0 items-center px-10"
            style={{ bottom: Math.max(220, insets.bottom + 190) }}
          >
            <View className="w-full max-w-[360px]">
              {/* Fiducial detection indicator */}
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-[12px] font-semibold uppercase tracking-wide text-emerald-100/90">
                  Corner Markers
                </Text>
                <View className="flex-row items-center gap-1">
                  {[0, 1, 2, 3].map((idx) => (
                    <View
                      key={idx}
                      className={`h-3 w-3 rounded-sm ${
                        idx < fiducialCount
                          ? fiducialReady
                            ? 'bg-emerald-400'
                            : 'bg-amber-400'
                          : 'bg-white/20'
                      }`}
                    />
                  ))}
                  <Text className="ml-1 text-[12px] font-semibold text-emerald-50">
                    {fiducialCount}/4
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
        <View className="absolute bottom-0 w-full px-6 pb-8">
          <View className="mb-4 flex-row gap-3">
            <TouchableOpacity
              activeOpacity={0.85}
              className={`flex-1 rounded-full border px-4 py-2 ${
                torchEnabled ? 'border-amber-300/80 bg-amber-500/30' : 'border-white/40 bg-black/50'
              }`}
              onPress={() => setTorchEnabled((prev) => !prev)}
            >
              <Text className="text-center text-[13px] font-semibold text-white">
                Flash {torchEnabled ? 'On' : 'Off'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              className={`flex-1 rounded-full border px-4 py-2 ${
                autoCaptureEnabled ? 'border-emerald-300/80 bg-emerald-500/20' : 'border-white/40 bg-black/50'
              }`}
              onPress={() => {
                setAutoCaptureEnabled((prev) => {
                  const next = !prev;
                  if (!next) {
                    clearAutoCaptureTimer();
                  }
                  return next;
                });
              }}
            >
              <Text className="text-center text-[13px] font-semibold text-white">
                Auto Capture {autoCaptureEnabled ? 'On' : 'Off'}
              </Text>
            </TouchableOpacity>
          </View>
          <View className="mb-3 h-[1px] bg-white/30" />
          <View className="flex-row items-center justify-between gap-4">
            <TouchableOpacity
              activeOpacity={0.8}
              className="flex-1 rounded-full border border-white/40 bg-black/60 px-4 py-3"
              onPress={handleCloseCamera}
            >
              <Text className="text-center text-[14px] font-medium text-white">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.9}
              className={`flex-1 rounded-full px-4 py-3 ${
                cameraReady ? 'bg-emerald-500' : 'bg-emerald-500/40'
              }`}
              disabled={!cameraReady}
              onPress={handleTakePhoto}
            >
              <Text className="text-center text-[15px] font-semibold text-emerald-50">Capture</Text>
            </TouchableOpacity>
          </View>
          <Text className="mt-2 text-center text-[11px] text-white/70">{captureStatusText}</Text>
        </View>
      </View>
    </Modal>
  );

  const processCaptureWithOCR = useCallback(async (asset) => {
    if (!asset) return;
    setOcrLoading(true);
    setOcrError('');
    setOcrApplied(false);
    try {
      console.log('OCR upload starting:', asset.uri);
      const response = await uploadDataCardForOCR(asset);
      const parsed = response?.parsed || {};
      console.log('OCR parsed payload:', parsed);
      const sanitized = {};
      Object.entries(parsed).forEach(([rawKey, value]) => {
        const canonicalKey = resolveOcrFieldKey(rawKey);
        if (!canonicalKey) {
          console.warn('[ocr] Unmapped field from backend:', rawKey, value);
          return;
        }
        if (!numericFormFields.includes(canonicalKey)) {
          console.warn('[ocr] Ignoring non-numeric field:', canonicalKey, value);
          return;
        }
        if (value === undefined || value === null || value === '') {
          console.warn('[ocr] Empty value skipped for field:', canonicalKey);
          return;
        }
        sanitized[canonicalKey] = String(value).trim();
      });

      if (Object.keys(sanitized).length === 0) {
        console.warn('[ocr] No mapped numeric fields detected from payload:', parsed);
        setOcrError('No structured values detected. Manually enter them.');
        return;
      }

      setForm((prev) => ({ ...prev, ...sanitized }));
      console.log('OCR parsing succeeded with fields:', sanitized);
      setOcrApplied(true);
    } catch (error) {
      console.error('OCR processing failed:', error);
      setOcrError(error.message || 'Failed to process capture.');
    } finally {
      setOcrLoading(false);
      console.log('OCR upload finished');
    }
  }, [setForm]);

  const handleCloseResult = useCallback(() => {
    setResultModalVisible(false);
  }, []);

  const EMPTY_FORM = {
    pH: '', hardness: '', solids: '', chloramines: '', sulfate: '',
    conductivity: '', organicCarbon: '', trihalomethanes: '', turbidity: '',
    freeChlorineResidual: '', color: 'Clear', source: 'Surface water',
  };

  const handleClearAll = useCallback(() => {
    setForm(EMPTY_FORM);
    setCapturePreview(null);
    setOcrApplied(false);
    setOcrError('');
    setCameraError('');
    setPreprocessNotes('');
    setSubmitError('');
  }, []);

  const buildSamplePayload = useCallback(() => {
    return {
      ph: parseNumericInput(form.pH),
      hardness: parseNumericInput(form.hardness),
      solids: parseNumericInput(form.solids),
      chloramines: parseNumericInput(form.chloramines),
      sulfate: parseNumericInput(form.sulfate),
      conductivity: parseNumericInput(form.conductivity),
      organicCarbon: parseNumericInput(form.organicCarbon),
      trihalomethanes: parseNumericInput(form.trihalomethanes),
      turbidity: parseNumericInput(form.turbidity),
      freeChlorineResidual: parseNumericInput(form.freeChlorineResidual),
      color: form.color,
      source: form.source,
    };
  }, [form]);

  const handleSubmit = useCallback(async () => {
    setSubmitError('');
    setResultModalVisible(false);
    const sessionResult = await supabase.auth.getSession();
    const userId = sessionResult?.data?.session?.user?.id || null;
    const payload = { ...buildSamplePayload(), userId };
    const numericValues = [
      payload.ph,
      payload.hardness,
      payload.solids,
      payload.chloramines,
      payload.sulfate,
      payload.conductivity,
      payload.organicCarbon,
      payload.trihalomethanes,
      payload.turbidity,
      payload.freeChlorineResidual,
    ].filter((value) => typeof value === 'number' && Number.isFinite(value));

    if (numericValues.length < 3) {
      setSubmitError('Enter at least three numeric parameters before running checks.');
      return;
    }

    setSubmitLoading(true);
    try {
      const result = await submitWaterSample(payload);
      let resolvedResult = result;

      if (!result?.saved && userId) {
        const record = {
          user_id: userId,
          sample_label: null,
          ph: payload.ph,
          hardness: payload.hardness,
          solids: payload.solids,
          chloramines: payload.chloramines,
          sulfate: payload.sulfate,
          conductivity: payload.conductivity,
          organic_carbon: payload.organicCarbon,
          trihalomethanes: payload.trihalomethanes,
          turbidity: payload.turbidity,
          free_chlorine_residual: payload.freeChlorineResidual,
          color: payload.color,
          source: payload.source,
          notes: null,
          prediction_probability: result.probability,
          prediction_is_potable: result.isPotable,
          risk_level: result.riskLevel,
          model_version: result.modelVersion,
          anomaly_checks: result.checks || [],
          microbial_risk: result.microbialRiskLevel || null,
          microbial_score: result.microbialScore ?? null,
          possible_bacteria: result.possibleBacteria || [],
        };

        const { data, error: insertError } = await supabase
          .from(SUPABASE_SAMPLES_TABLE)
          .insert(record)
          .select('id')
          .single();

        if (!insertError && data?.id) {
          resolvedResult = {
            ...result,
            saved: true,
            sampleId: data.id,
          };
        } else if (insertError) {
          console.warn('[Supabase] sample insert failed:', insertError.message || insertError);
        }
      }

      setPredictionResult(resolvedResult);
      setResultModalVisible(true);
    } catch (error) {
      setSubmitError(error?.message || 'Failed to save and analyze sample.');
    } finally {
      setSubmitLoading(false);
    }
  }, [buildSamplePayload]);

  const alignmentPercent = Math.round(alignmentScore * 100);
  const countdownSeconds = (autoCaptureCountdown / 1000).toFixed(1);
  const countdownLabel = autoCaptureEnabled && autoCaptureCountdown > 0 ? ` · auto capture in ${countdownSeconds}s` : '';
  const scrollBottomPadding = Math.max(112, insets.bottom + FLOATING_TAB_BAR_CLEARANCE);
  const captureStatusText = cameraReady
    ? autoCaptureEnabled
      ? `${alignmentStatus || 'Hold steady for auto capture'} · alignment ${alignmentPercent}%${countdownLabel}`
      : `Manual capture · alignment ${alignmentPercent}%`
    : 'Initializing camera…';

  // Per-section field fill counts for CollapsibleSection badges
  const isFilled = (k) => String(form[k] ?? '').trim().length > 0;
  const coreFilledCount  = ['pH', 'hardness', 'solids', 'conductivity'].filter(isFilled).length;
  const chemFilledCount  = ['chloramines', 'sulfate', 'organicCarbon', 'trihalomethanes'].filter(isFilled).length;
  const physFilledCount  = ['turbidity', 'freeChlorineResidual'].filter(isFilled).length;
  const totalFilledCount = coreFilledCount + chemFilledCount + physFilledCount;
  return (
    <>
      {cameraModal}
      <WaterResultScreen
        visible={resultModalVisible && Boolean(predictionResult)}
        result={predictionResult}
        onClose={handleCloseResult}
      />
      <KeyboardAvoidingView
        className={`flex-1 ${isDark ? 'bg-aquadark' : 'bg-slate-100'}`}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="px-5 pt-10"
          contentContainerClassName="gap-6"
          contentContainerStyle={{ paddingBottom: scrollBottomPadding }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={{
              opacity: heroAnim,
              transform: [
                {
                  translateY: heroAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [24, 0],
                  }),
                },
              ],
              borderRadius: 34,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(12,74,110,0.7)' : '#cbd5e1',
              backgroundColor: isDark ? 'rgba(2,6,23,0.9)' : '#ffffff',
              paddingHorizontal: 20,
              paddingBottom: 24,
              paddingTop: 28,
            }}
          >
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                activeOpacity={0.85}
                className={`rounded-full border px-3 py-1.5 ${isDark ? 'border-sky-900/70 bg-slate-950/60' : 'border-slate-300 bg-slate-100'}`}
                onPress={() => onNavigate && onNavigate('home')}
              >
                <View className="flex-row items-center gap-1.5">
                  <Feather name="home" size={12} color={isDark ? '#e0f2fe' : '#1f2937'} />
                  <Text className={`text-[12px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>Dashboard</Text>
                </View>
              </TouchableOpacity>
              <View className="items-center gap-1">
                <View className={`h-16 w-16 overflow-hidden rounded-[22px] border ${isDark ? 'border-sky-800/70 bg-slate-950/70' : 'border-slate-300 bg-slate-200'}`}>
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} className="h-full w-full" resizeMode="cover" />
                  ) : (
                    <View className="h-full w-full items-center justify-center">
                      <Text className={`text-[18px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-800'}`}>{getInitials(profileName)}</Text>
                    </View>
                  )}
                </View>
                <Text className={`text-[13px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>{profileName || 'Field operator'}</Text>
                <Text className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Field intelligence</Text>
              </View>
              <View
                className={`rounded-2xl border px-3 py-2 ${
                  isDark ? 'border-sky-500/50 bg-sky-900/20' : 'border-sky-300 bg-sky-100'
                }`}
              >
                <View className="flex-row items-center gap-1.5">
                  <MaterialCommunityIcons
                    name="text-recognition"
                    size={12}
                    color={isDark ? '#7dd3fc' : '#0369a1'}
                  />
                  <Text
                    className={`text-[11px] font-semibold uppercase tracking-wide ${
                      isDark ? 'text-sky-200' : 'text-sky-800'
                    }`}
                  >
                    OCR Ready
                  </Text>
                </View>
              </View>
            </View>

            <View className="mt-6 items-center">
              <Text className={`text-[11px] uppercase tracking-[3px] text-center ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>
                Field capture
              </Text>
              <Text className={`mt-2 text-[22px] font-semibold text-center ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
                {getGreetingLabel()}, {profileName ? profileName.split(' ')[0] : 'operator'}
              </Text>
              <Text className={`mt-2 text-[13px] text-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Manual + OCR capture for downstream risk scoring and model retraining.
              </Text>
            </View>

            <View className="mt-5 flex-row gap-3">
              {/* Last sample card */}
              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: isDark ? 'rgba(14,165,233,0.22)' : '#bae6fd',
                  backgroundColor: isDark ? 'rgba(2,12,30,0.85)' : '#f0f9ff',
                  padding: 11,
                  overflow: 'hidden',
                }}
              >
                {/* Accent glow strip */}
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    borderTopLeftRadius: 20,
                    borderTopRightRadius: 20,
                    backgroundColor: isDark ? '#0ea5e9' : '#38bdf8',
                    opacity: 0.7,
                  }}
                />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 }}>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 9,
                      backgroundColor: isDark ? 'rgba(14,165,233,0.18)' : '#bae6fd',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name="water-check-outline" size={13} color={isDark ? '#38bdf8' : '#0284c7'} />
                  </View>
                  <Text
                    style={{
                      fontSize: 9,
                      fontWeight: '700',
                      letterSpacing: 1.1,
                      textTransform: 'uppercase',
                      color: isDark ? '#38bdf8' : '#0284c7',
                    }}
                  >
                    Last sample
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: isDark ? '#f0f9ff' : '#0c4a6e',
                    lineHeight: 17,
                  }}
                  numberOfLines={1}
                >
                  {latestSampleLabel}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                  <Feather name="clock" size={9} color={isDark ? '#64748b' : '#7dd3fc'} />
                  <Text style={{ fontSize: 10, color: isDark ? '#64748b' : '#0369a1' }} numberOfLines={1}>
                    {latestSampleMeta}
                  </Text>
                </View>
              </View>

              {/* Samples today card */}
              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: isDark ? 'rgba(139,92,246,0.28)' : '#ddd6fe',
                  backgroundColor: isDark ? 'rgba(10,4,30,0.85)' : '#faf5ff',
                  padding: 11,
                  overflow: 'hidden',
                }}
              >
                {/* Accent glow strip */}
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    borderTopLeftRadius: 20,
                    borderTopRightRadius: 20,
                    backgroundColor: isDark ? '#8b5cf6' : '#a78bfa',
                    opacity: 0.75,
                  }}
                />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 }}>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 9,
                      backgroundColor: isDark ? 'rgba(139,92,246,0.18)' : '#ede9fe',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name="chart-bar" size={13} color={isDark ? '#a78bfa' : '#7c3aed'} />
                  </View>
                  <Text
                    style={{
                      fontSize: 9,
                      fontWeight: '700',
                      letterSpacing: 1.1,
                      textTransform: 'uppercase',
                      color: isDark ? '#a78bfa' : '#7c3aed',
                    }}
                  >
                    Today
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 22,
                    fontWeight: '800',
                    color: isDark ? '#ede9fe' : '#4c1d95',
                    lineHeight: 26,
                  }}
                >
                  {todaySamplesCount}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                  <MaterialCommunityIcons name="database-outline" size={9} color={isDark ? '#64748b' : '#a78bfa'} />
                  <Text style={{ fontSize: 10, color: isDark ? '#64748b' : '#6d28d9' }}>
                    {totalSamplesCount} total saved
                  </Text>
                </View>
              </View>
            </View>
          </Animated.View>

          <Animated.View
            style={{
              opacity: sectionsAnim,
              transform: [
                {
                  translateY: sectionsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0],
                  }),
                },
              ],
              borderRadius: 34,
              padding: 20,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(12,74,110,0.8)' : '#cbd5e1',
              backgroundColor: isDark ? 'rgba(2,6,23,0.7)' : '#ffffff',
            }}
          >
            <View className="flex-row items-start justify-between gap-4">
              <View className="flex-1">
                <Text className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                  Image-assisted capture
                </Text>
                <Text className={`mt-2 text-[13px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  Snap the standardized sheet; EasyOCR fills all 10 water-quality fields instantly when legible.
                </Text>
              </View>
              <View className={`rounded-2xl border px-3 py-2 ${isDark ? 'border-sky-900/60 bg-slate-900/60' : 'border-slate-300 bg-slate-100'}`}>
                <Text className={`text-[11px] font-semibold ${isDark ? 'text-sky-200' : 'text-sky-600'}`}>
                  {capturePreview ? 'Retake ready' : 'Camera idle'}
                </Text>
              </View>
            </View>
            <View className="mt-5">
              <PredictButton
                title={capturePreview ? 'Retake capture' : 'Capture data card'}
                icon={capturePreview ? 'camera-retake-outline' : 'camera-outline'}
                iconSize={18}
                onPress={handleOpenCamera}
              />
              {cameraError ? (
                <Text className="mt-2 text-[11px] text-rose-400">{cameraError}</Text>
              ) : null}
            </View>

            {/* OCR result card — shown while processing or after capture */}
            {(capturePreview || preprocessing) ? (
              <View
                className={`mt-4 overflow-hidden rounded-[24px] border ${
                  isDark ? 'border-sky-900/60 bg-slate-900/80' : 'border-slate-200 bg-slate-50'
                }`}
              >
                {/* Image strip */}
                <View style={{ height: 140 }} className="w-full overflow-hidden">
                  {capturePreview ? (
                    <Image
                      source={{ uri: capturePreview.uri }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      className={`h-full w-full items-center justify-center ${
                        isDark ? 'bg-slate-800' : 'bg-slate-200'
                      }`}
                    >
                      <MaterialCommunityIcons
                        name="image-outline"
                        size={28}
                        color={isDark ? '#334155' : '#cbd5e1'}
                      />
                    </View>
                  )}

                  {/* Status chip — top right of image */}
                  {capturePreview && !ocrLoading && !preprocessing && (
                    <View
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        borderRadius: 99,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        backgroundColor: ocrApplied
                          ? 'rgba(16,185,129,0.85)'
                          : ocrError
                          ? 'rgba(244,63,94,0.85)'
                          : 'rgba(15,23,42,0.65)',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <MaterialCommunityIcons
                        name={
                          ocrApplied
                            ? 'check-circle-outline'
                            : ocrError
                            ? 'alert-circle-outline'
                            : 'image-check-outline'
                        }
                        size={11}
                        color="#fff"
                      />
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                        {ocrApplied
                          ? `${totalFilledCount} field${totalFilledCount !== 1 ? 's' : ''} extracted`
                          : ocrError
                          ? 'OCR failed'
                          : 'Captured'}
                      </Text>
                    </View>
                  )}

                  {/* OCR loading overlay */}
                  {(ocrLoading || preprocessing) && (
                    <View
                      style={{
                        ...StyleSheet.absoluteFillObject,
                        backgroundColor: 'rgba(2,8,23,0.55)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                      }}
                    >
                      <Animated.View
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          borderWidth: 2.5,
                          borderColor: '#38bdf8',
                          borderTopColor: 'transparent',
                          transform: [{ rotate: spinnerRotation }],
                        }}
                      />
                      <Text style={{ color: '#e0f2fe', fontSize: 12, fontWeight: '600' }}>
                        {preprocessing ? 'Optimizing…' : 'Extracting values…'}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Caption row below image */}
                <View className="px-4 py-3">
                  {ocrApplied && !ocrLoading ? (
                    <>
                      <View className="flex-row items-center gap-2">
                        <MaterialCommunityIcons
                          name="text-recognition"
                          size={14}
                          color={isDark ? '#34d399' : '#059669'}
                        />
                        <Text className={`text-[13px] font-semibold ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                          Fields filled automatically
                        </Text>
                      </View>
                      {/* Field chips */}
                      <View className="mt-2 flex-row flex-wrap gap-1.5">
                        {numericFormFields
                          .filter((k) => String(form[k] ?? '').trim().length > 0)
                          .map((k) => (
                            <View
                              key={k}
                              style={{
                                borderRadius: 99,
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                                backgroundColor: isDark ? 'rgba(16,185,129,0.15)' : '#d1fae5',
                                borderWidth: 1,
                                borderColor: isDark ? 'rgba(52,211,153,0.3)' : '#6ee7b7',
                              }}
                            >
                              <Text style={{ fontSize: 10, fontWeight: '600', color: isDark ? '#6ee7b7' : '#065f46' }}>
                                {k}
                              </Text>
                            </View>
                          ))}
                      </View>
                      <Text className={`mt-2 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                        Review values below — expand any section to verify.
                      </Text>
                    </>
                  ) : ocrError ? (
                    <View className="flex-row items-center gap-2">
                      <MaterialCommunityIcons name="alert-circle-outline" size={14} color="#f43f5e" />
                      <Text className="text-[12px] text-rose-400 flex-1">{ocrError}</Text>
                    </View>
                  ) : !ocrLoading && !preprocessing && capturePreview ? (
                    <View className="flex-row items-center gap-2">
                      <MaterialCommunityIcons
                        name="image-check-outline"
                        size={14}
                        color={isDark ? '#94a3b8' : '#64748b'}
                      />
                      <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {preprocessNotes || 'Awaiting OCR result…'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}
          </Animated.View>

          <Animated.View
            style={{
              opacity: sectionsAnim,
              transform: [
                {
                  translateY: sectionsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [12, 0],
                  }),
                },
              ],
              gap: 12,
            }}
          >
            {/* Manual entry section header */}
            <View className="flex-row items-center justify-between px-1 pt-1">
              <View className="flex-row items-center gap-2">
                <Feather name="edit-3" size={13} color={isDark ? '#38bdf8' : '#0284c7'} />
                <Text className={`text-[12px] font-semibold ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                  Manual entry
                </Text>
                <Text className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  · optional if using OCR
                </Text>
              </View>
              {totalFilledCount > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View
                    style={{
                      width: 6, height: 6, borderRadius: 3,
                      backgroundColor: totalFilledCount === 10 ? '#10b981' : '#f59e0b',
                    }}
                  />
                  <Text className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {totalFilledCount}/10
                  </Text>
                </View>
              )}
            </View>

            {/* Core parameters — collapsed by default */}
            <CollapsibleSection
              title="Core parameters"
              icon="water-outline"
              fieldCount={4}
              filledCount={coreFilledCount}
              isDark={isDark}
            >
              <View className="mt-3 flex-row gap-3">
                <View className="flex-1">
                  <InputField
                    label="pH (dimensionless)"
                    placeholder="e.g. 7.2"
                    keyboardType="numeric"
                    value={form.pH}
                    onChangeText={(v) => updateField('pH', v)}
                  />
                </View>
                <View className="flex-1">
                  <InputField
                    label="Hardness (mg/L as CaCO₃)"
                    placeholder="e.g. 180"
                    keyboardType="numeric"
                    value={form.hardness}
                    onChangeText={(v) => updateField('hardness', v)}
                  />
                </View>
              </View>
              <View className="mt-4 flex-row gap-3">
                <View className="flex-1">
                  <InputField
                    label="Solids (mg/L)"
                    placeholder="e.g. 320"
                    keyboardType="numeric"
                    value={form.solids}
                    onChangeText={(v) => updateField('solids', v)}
                  />
                </View>
                <View className="flex-1">
                  <InputField
                    label="Conductivity (µS/cm)"
                    placeholder="e.g. 410"
                    keyboardType="numeric"
                    value={form.conductivity}
                    onChangeText={(v) => updateField('conductivity', v)}
                  />
                </View>
              </View>
            </CollapsibleSection>

            {/* Chemical compounds — collapsed by default */}
            <CollapsibleSection
              title="Chemical compounds"
              icon="flask-outline"
              fieldCount={4}
              filledCount={chemFilledCount}
              isDark={isDark}
            >
              <View className="mt-3 flex-row gap-3">
                <View className="flex-1">
                  <InputField
                    label="Chloramines (mg/L)"
                    placeholder="e.g. 4.0"
                    keyboardType="numeric"
                    value={form.chloramines}
                    onChangeText={(v) => updateField('chloramines', v)}
                  />
                </View>
                <View className="flex-1">
                  <InputField
                    label="Sulfate (mg/L)"
                    placeholder="e.g. 250"
                    keyboardType="numeric"
                    value={form.sulfate}
                    onChangeText={(v) => updateField('sulfate', v)}
                  />
                </View>
              </View>
              <View className="mt-4 flex-row gap-3">
                <View className="flex-1">
                  <InputField
                    label="Organic Carbon (mg/L)"
                    placeholder="e.g. 12.5"
                    keyboardType="numeric"
                    value={form.organicCarbon}
                    onChangeText={(v) => updateField('organicCarbon', v)}
                  />
                </View>
                <View className="flex-1">
                  <InputField
                    label="Trihalomethanes (µg/L)"
                    placeholder="e.g. 80"
                    keyboardType="numeric"
                    value={form.trihalomethanes}
                    onChangeText={(v) => updateField('trihalomethanes', v)}
                  />
                </View>
              </View>
            </CollapsibleSection>

            {/* Physical & disinfectant — collapsed by default */}
            <CollapsibleSection
              title="Physical & disinfectant"
              icon="thermometer"
              fieldCount={2}
              filledCount={physFilledCount}
              isDark={isDark}
            >
              <View className="mt-3 flex-row gap-3">
                <View className="flex-1">
                  <InputField
                    label="Turbidity (NTU)"
                    placeholder="e.g. 4.5"
                    keyboardType="numeric"
                    value={form.turbidity}
                    onChangeText={(v) => updateField('turbidity', v)}
                  />
                </View>
                <View className="flex-1">
                  <InputField
                    label="Free Chlorine Residual (mg/L)"
                    placeholder="e.g. 0.5"
                    keyboardType="numeric"
                    value={form.freeChlorineResidual}
                    onChangeText={(v) => updateField('freeChlorineResidual', v)}
                  />
                </View>
              </View>
            </CollapsibleSection>

            {/* Visual & context — collapsed by default */}
            <CollapsibleSection
              title="Visual & context"
              icon="eye-outline"
              fieldCount={2}
              filledCount={
                (form.color && form.color !== colorOptions[0] ? 1 : 0) +
                (form.source && form.source !== sourceOptions[0] ? 1 : 0)
              }
              isDark={isDark}
            >
              <View className="mt-3">
                <Text className={`mb-2 text-[13px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>Color</Text>
                <View className="flex-row flex-wrap gap-2">
                  {colorOptions.map((option) => {
                    const selected = form.color === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        activeOpacity={0.85}
                        className={`rounded-full border px-3 py-1.5 ${
                          selected
                            ? 'border-aquaaccent bg-aquaaccent/15'
                            : isDark
                            ? 'border-slate-800 bg-slate-950'
                            : 'border-slate-300 bg-slate-50'
                        }`}
                        onPress={() => updateField('color', option)}
                      >
                        <Text
                          className={`text-[12px] ${
                            selected ? 'text-aquaaccent' : isDark ? 'text-slate-300' : 'text-slate-700'
                          }`}
                        >
                          {option}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View className="mt-5">
                <Text className={`mb-2 text-[13px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
                  Source (sampling context)
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {sourceOptions.map((option) => {
                    const selected = form.source === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        activeOpacity={0.85}
                        className={`rounded-full border px-3 py-1.5 ${
                          selected
                            ? 'border-emerald-400 bg-emerald-500/20'
                            : isDark
                            ? 'border-slate-800 bg-slate-950'
                            : 'border-slate-300 bg-slate-50'
                        }`}
                        onPress={() => updateField('source', option)}
                      >
                        <Text
                          className={`text-[12px] ${
                            selected ? (isDark ? 'text-emerald-50' : 'text-emerald-700') : isDark ? 'text-slate-300' : 'text-slate-700'
                          }`}
                        >
                          {option}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </CollapsibleSection>
          </Animated.View>

          <View className={`rounded-[32px] p-5 ${isDark ? 'border border-sky-900/70 bg-slate-950/80' : 'border border-slate-300 bg-white'}`}>
            <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Finalize and sync this sample to kick off anomaly detection, historical comparisons, and model retraining cues.
            </Text>
            <PredictButton
              title={submitLoading ? 'Saving sample…' : 'Save sample & run checks'}
              icon={submitLoading ? undefined : 'cloud-upload-outline'}
              iconSize={18}
              onPress={handleSubmit}
              className="mt-4"
              disabled={submitLoading}
            />
            {submitLoading ? (
              <View className="mt-3 flex-row items-center justify-center gap-2">
                <ActivityIndicator color="#34d399" size="small" />
                <Text className={`text-[12px] ${isDark ? 'text-emerald-200' : 'text-emerald-700'}`}>
                  Syncing and running model checks…
                </Text>
              </View>
            ) : null}
            {submitError ? (
              <Text className={`mt-3 text-center text-[12px] ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>
                {submitError}
              </Text>
            ) : null}

            {/* Clear all — shown only when there is something to clear */}
            {totalFilledCount > 0 || capturePreview ? (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={handleClearAll}
                disabled={submitLoading}
                className={`mt-3 w-full flex-row items-center justify-center gap-2 rounded-full border py-2.5 ${
                  isDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-300 bg-slate-50'
                } ${submitLoading ? 'opacity-40' : ''}`}
              >
                <Feather name="trash-2" size={14} color={isDark ? '#f87171' : '#ef4444'} />
                <Text
                  className={`text-[13px] font-semibold ${isDark ? 'text-rose-400' : 'text-rose-500'}`}
                >
                  Clear all entries
                </Text>
              </TouchableOpacity>
            ) : null}

            <Text className="mt-2 text-center text-[11px] text-slate-500">
              Values feed into image-assisted models for early disease detection.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
};

export default DataInputScreen;
