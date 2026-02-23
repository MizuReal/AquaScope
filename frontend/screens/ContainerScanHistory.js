import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  Image,
  Animated,
} from 'react-native';
import LottieView from 'lottie-react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../utils/supabaseClient';
import { getContainerCleaningSuggestion } from '../utils/api';

const loadingAnim = require('../assets/public/loading.json');
const PAGE_SIZE = 10;

const SUPABASE_CONTAINER_SCANS_TABLE = process.env.EXPO_PUBLIC_SUPABASE_CONTAINER_SCANS_TABLE || 'container_scans';

const CLASS_META = {
  Clean: { color: '#22c55e', label: 'Clean', mcIcon: 'check-circle', severity: 'safe' },
  LightMoss: { color: '#facc15', label: 'Light Moss', mcIcon: 'alert-circle-outline', severity: 'low' },
  MediumMoss: { color: '#f97316', label: 'Medium Moss', mcIcon: 'alert', severity: 'moderate' },
  HeavyMoss: { color: '#ef4444', label: 'Heavy Moss', mcIcon: 'close-circle', severity: 'high' },
  Unknown: { color: '#64748b', label: 'Not Recognized', mcIcon: 'help-circle-outline', severity: 'unknown' },
};

const SEVERITY_BADGE = {
  safe: { label: 'Safe', textDark: 'text-emerald-300', textLight: 'text-emerald-700', borderDark: 'border-emerald-500/40', borderLight: 'border-emerald-300', bgDark: 'bg-emerald-900/30', bgLight: 'bg-emerald-50' },
  low: { label: 'Low Risk', textDark: 'text-yellow-300', textLight: 'text-yellow-700', borderDark: 'border-yellow-500/40', borderLight: 'border-yellow-300', bgDark: 'bg-yellow-900/30', bgLight: 'bg-yellow-50' },
  moderate: { label: 'Moderate', textDark: 'text-orange-300', textLight: 'text-orange-700', borderDark: 'border-orange-500/40', borderLight: 'border-orange-300', bgDark: 'bg-orange-900/30', bgLight: 'bg-orange-50' },
  high: { label: 'High Risk', textDark: 'text-red-300', textLight: 'text-red-700', borderDark: 'border-red-500/40', borderLight: 'border-red-300', bgDark: 'bg-red-900/30', bgLight: 'bg-red-50' },
  unknown: { label: 'Unknown', textDark: 'text-slate-400', textLight: 'text-slate-600', borderDark: 'border-slate-700/40', borderLight: 'border-slate-300', bgDark: 'bg-slate-900/30', bgLight: 'bg-slate-100' },
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'timestamp unavailable';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'timestamp unavailable';
  return date.toLocaleString();
};

const classifyImageUri = (uri) => {
  if (!uri) return 'none';
  if (uri.startsWith('file://')) return 'local-device';
  if (uri.includes('/storage/v1/object/public/')) return 'supabase-public';
  return 'other';
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

const deriveStatus = (scan) => {
  if (!scan?.is_valid) return 'Review';
  const cls = scan?.predicted_class;
  if (cls === 'Clean') return 'Cleared';
  if (cls === 'LightMoss') return 'Review';
  return 'Alert';
};

const getStatusStyleClass = (status, isDark) => {
  if (status === 'Cleared') {
    return isDark ? 'border-emerald-500/60 bg-emerald-500/15' : 'border-emerald-300 bg-emerald-100';
  }
  if (status === 'Review') {
    return isDark ? 'border-amber-500/60 bg-amber-500/10' : 'border-amber-300 bg-amber-100';
  }
  if (status === 'Alert') {
    return isDark ? 'border-rose-500/60 bg-rose-500/10' : 'border-rose-300 bg-rose-100';
  }
  return isDark ? 'border-sky-700 bg-sky-900/40' : 'border-slate-300 bg-slate-100';
};

const getStatusTextClass = (status, isDark) => {
  if (status === 'Cleared') {
    return isDark ? 'text-emerald-100' : 'text-emerald-800';
  }
  if (status === 'Review') {
    return isDark ? 'text-amber-200' : 'text-amber-800';
  }
  if (status === 'Alert') {
    return isDark ? 'text-rose-200' : 'text-rose-800';
  }
  return isDark ? 'text-sky-100' : 'text-slate-800';
};

const getCardBorderClass = (status, isDark) => {
  if (status === 'Cleared') {
    return isDark ? 'border-emerald-600/50' : 'border-emerald-300';
  }
  if (status === 'Review') {
    return isDark ? 'border-amber-500/50' : 'border-amber-300';
  }
  if (status === 'Alert') {
    return isDark ? 'border-rose-500/50' : 'border-rose-300';
  }
  return isDark ? 'border-sky-900/50' : 'border-slate-200';
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

const ConfidenceBar = ({ label, value, color, isDark }) => {
  const barAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barAnim, {
      toValue: value,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [value, barAnim]);

  return (
    <View className="mb-3">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className={`text-[12px] font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          {label}
        </Text>
        <Text style={{ color }} className="text-[12px] font-bold">
          {Math.round(value * 100)}%
        </Text>
      </View>
      <View className={`h-2.5 overflow-hidden rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
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

const ContainerScanHistory = React.forwardRef(({ isDark, active }, ref) => {
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [records, setRecords] = useState([]);
  const [selectedScan, setSelectedScan] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [advisorText, setAdvisorText] = useState('');
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState('');
  const pageRef = useRef(0);
  const isMountedRef = useRef(true);

  const fetchPage = async (page, isInitial) => {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    try {
      const sessionResult = await supabase.auth.getSession();
      const userId = sessionResult?.data?.session?.user?.id || null;
      if (!userId) {
        if (isMountedRef.current) setRecords([]);
        return;
      }

      const { data, error } = await supabase
        .from(SUPABASE_CONTAINER_SCANS_TABLE)
        .select('id, created_at, predicted_class, confidence, is_valid, rejection_reason, entropy, margin, probabilities, image_uri')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.warn('[Supabase] failed to load container history:', error.message || error);
        return;
      }

      const rows = data || [];
      if (isMountedRef.current) {
        if (isInitial) {
          setRecords(rows);
        } else {
          setRecords((prev) => [...prev, ...rows]);
        }
        setHasMore(rows.length === PAGE_SIZE);
        pageRef.current = page + 1;
      }
    } catch (err) {
      console.warn('[Supabase] unexpected container history error:', err?.message || err);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    if (!active) return;

    pageRef.current = 0;
    setHasMore(true);
    setLoading(true);
    fetchPage(0, true).finally(() => {
      if (isMountedRef.current) setLoading(false);
    });

    return () => {
      isMountedRef.current = false;
    };
  }, [active]);

  useImperativeHandle(ref, () => ({
    loadMore: () => {
      if (!hasMore || loadingMore || loading) return;
      setLoadingMore(true);
      fetchPage(pageRef.current, false).finally(() => {
        if (isMountedRef.current) setLoadingMore(false);
      });
    },
  }));

  const mappedRecords = useMemo(
    () =>
      records.map((record) => {
        const status = deriveStatus(record);
        const confidence = Number.isFinite(record?.confidence)
          ? Number(record.confidence)
          : 0;
        const confidencePct = Math.min(100, Math.max(0, confidence * 100));

        return {
          ...record,
          _status: status,
          _confidencePct: confidencePct,
          _classLabel: CLASS_META[record?.predicted_class]?.label || record?.predicted_class || 'Unknown',
        };
      }),
    [records]
  );

  useEffect(() => {
    if (!detailOpen || !selectedScan) {
      return;
    }

    let cancelled = false;
    setAdvisorText('');
    setAdvisorError('');
    setAdvisorLoading(true);

    const analysisPayload = {
      predicted_class: selectedScan.predicted_class || 'Unknown',
      confidence: Number.isFinite(selectedScan.confidence) ? Number(selectedScan.confidence) : 0,
      is_valid: Boolean(selectedScan.is_valid),
      rejection_reason: selectedScan.rejection_reason || null,
      entropy: selectedScan.entropy,
      margin: selectedScan.margin,
      probabilities:
        selectedScan?.probabilities && typeof selectedScan.probabilities === 'object'
          ? selectedScan.probabilities
          : {},
    };

    getContainerCleaningSuggestion(analysisPayload)
      .then((response) => {
        if (!cancelled) {
          setAdvisorText(response?.suggestion || 'No suggestion available.');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAdvisorError(error?.message || 'Failed to get cleaning guidance.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAdvisorLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailOpen, selectedScan]);

  const getConfidenceColor = (pct) => {
    if (pct >= 80) return { bar: 'bg-emerald-500', text: isDark ? 'text-emerald-300' : 'text-emerald-600' };
    if (pct >= 65) return { bar: 'bg-sky-400', text: isDark ? 'text-sky-300' : 'text-sky-600' };
    if (pct >= 45) return { bar: 'bg-amber-400', text: isDark ? 'text-amber-300' : 'text-amber-600' };
    return { bar: 'bg-rose-500', text: isDark ? 'text-rose-300' : 'text-rose-600' };
  };

  const closeModal = () => {
    setDetailOpen(false);
    setSelectedScan(null);
  };

  const openDetails = (item) => {
    console.log('[ContainerHistory] open report image_uri:', {
      id: item?.id,
      image_uri: item?.image_uri || null,
      uri_type: classifyImageUri(item?.image_uri || ''),
    });
    setSelectedScan(item);
    setDetailOpen(true);
  };

  if (loading) {
    return (
      <View className="items-center py-8">
        <ActivityIndicator size="small" color={isDark ? '#7dd3fc' : '#0284c7'} />
        <Text className={`mt-2 text-[12px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
          Loading container scans…
        </Text>
      </View>
    );
  }

  if (mappedRecords.length === 0) {
    return (
      <View className={`rounded-2xl border p-4 ${isDark ? 'border-sky-900/70 bg-sky-950/40' : 'border-slate-300 bg-slate-50'}`}>
        <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          No saved container scans yet. Analyze a container image to populate history.
        </Text>
      </View>
    );
  }

  return (
    <>
      {mappedRecords.map((item) => {
        const statusClass = getStatusStyleClass(item._status, isDark);
        const statusTextClass = getStatusTextClass(item._status, isDark);
        const cardBorderClass = getCardBorderClass(item._status, isDark);
        const confidencePct = item._confidencePct;
        const confColor = getConfidenceColor(confidencePct);

        return (
          <View
            key={item.id}
            className={`mb-3 rounded-2xl border p-4 ${cardBorderClass} ${isDark ? 'bg-slate-900/70' : 'bg-white'}`}
          >
            {/* Row 1 — class label + status badge */}
            <View className="flex-row items-center justify-between">
              <View className="flex-1 flex-row items-center gap-2.5 pr-3">
                {(() => {
                  const meta = CLASS_META[item.predicted_class] || CLASS_META.Unknown;
                  return (
                    <View
                      className="h-8 w-8 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${meta.color}22` }}
                    >
                      <MaterialCommunityIcons name={meta.mcIcon} size={16} color={meta.color} />
                    </View>
                  );
                })()}
                <View className="flex-1">
                  <Text className={`text-[15px] font-semibold leading-snug ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
                    {item._classLabel}
                  </Text>
                  <View className="flex-row items-center gap-1 mt-0.5">
                    <Feather name="clock" size={9} color={isDark ? '#475569' : '#94a3b8'} />
                    <Text className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      {formatTimestamp(item.created_at)}
                    </Text>
                  </View>
                </View>
              </View>
              <View className={`rounded-full border px-3 py-1 ${statusClass}`}>
                <Text className={`text-[11px] font-semibold ${statusTextClass}`}>
                  {item._status}
                </Text>
              </View>
            </View>

            {/* Row 2 — validity + confidence */}
            <View className="mt-3 flex-row items-end justify-between">
              <View className="flex-1 flex-row items-center gap-1.5 pr-4">
                <MaterialCommunityIcons
                  name={item.is_valid ? 'image-check-outline' : 'image-off-outline'}
                  size={13}
                  color={item.is_valid ? '#22c55e' : (isDark ? '#94a3b8' : '#64748b')}
                />
                <Text className={`text-[13px] ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  {item.is_valid ? 'Container recognized' : item.rejection_reason || 'Image not recognized'}
                </Text>
              </View>
              <Text className={`text-[20px] font-bold tabular-nums ${confColor.text}`}>
                {confidencePct.toFixed(0)}
                <Text className={`text-[12px] font-normal ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>%</Text>
              </Text>
            </View>

            <View className={`mt-2 h-1 w-full rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
              <View
                className={`h-full rounded-full ${confColor.bar}`}
                style={{ width: `${confidencePct}%` }}
              />
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => openDetails(item)}
              className={`mt-3 rounded-xl py-2.5 flex-row items-center justify-center gap-2 ${isDark ? 'bg-sky-900/40' : 'bg-slate-100'}`}
            >
              <Feather name="file-text" size={12} color={isDark ? '#7dd3fc' : '#475569'} />
              <Text className={`text-[12px] font-semibold ${isDark ? 'text-sky-200' : 'text-slate-700'}`}>
                View Full Report
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {loadingMore && (
        <View className="items-center py-6">
          <LottieView source={loadingAnim} autoPlay loop style={{ width: 64, height: 64 }} />
        </View>
      )}

      <Modal
        visible={detailOpen && Boolean(selectedScan)}
        animationType="slide"
        transparent={false}
        presentationStyle="fullScreen"
        onRequestClose={closeModal}
      >
        <SafeAreaView className={`flex-1 ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
          <View className={`flex-row items-center justify-between border-b px-5 py-4 ${isDark ? 'border-slate-900' : 'border-slate-300'}`}>
            <Text className={`text-[12px] font-semibold uppercase tracking-[4px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Container Scan Report
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close report"
              activeOpacity={0.85}
              onPress={closeModal}
              className={`rounded-full border px-4 py-1.5 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-300 bg-white'}`}
            >
              <Text className={`text-[12px] font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                Close
              </Text>
            </TouchableOpacity>
          </View>

          {selectedScan && (
            <ScrollView
              className="flex-1 px-5"
              contentContainerStyle={{ paddingBottom: 32, gap: 14, paddingTop: 20 }}
              showsVerticalScrollIndicator={false}
            >
                  <View className={`rounded-[24px] border ${isDark ? 'border-sky-900/70 bg-slate-950/70' : 'border-slate-300 bg-white'}`}>
                    <View className={`flex-row items-center gap-2 border-b px-5 py-4 ${isDark ? 'border-sky-900/50' : 'border-slate-100'}`}>
                      <MaterialCommunityIcons name="chart-donut" size={14} color={isDark ? '#38bdf8' : '#0284c7'} />
                      <Text className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                        Analysis Snapshot
                      </Text>
                    </View>

                    <View className="px-5 py-4">
                      {(() => {
                        const topClass = selectedScan?.predicted_class;
                        const isValid = Boolean(selectedScan?.is_valid);
                        const rejectionReason = selectedScan?.rejection_reason;
                        const meta = topClass ? (CLASS_META[topClass] || CLASS_META.Unknown) : CLASS_META.Unknown;
                        const badge = SEVERITY_BADGE[meta.severity];

                        return (
                          <View className="gap-4">
                            <View className="flex-row gap-3">
                              <View
                                className={`overflow-hidden rounded-2xl border ${isDark ? 'border-sky-900/60' : 'border-slate-200'}`}
                                style={{ width: 88, height: 88 }}
                              >
                                {selectedScan.image_uri ? (
                                  <Image source={{ uri: selectedScan.image_uri }} className="h-full w-full" resizeMode="cover" />
                                ) : (
                                  <View className={`h-full w-full items-center justify-center ${isDark ? 'bg-slate-900/80' : 'bg-slate-100'}`}>
                                    <MaterialCommunityIcons
                                      name="image-off-outline"
                                      size={20}
                                      color={isDark ? '#64748b' : '#94a3b8'}
                                    />
                                  </View>
                                )}
                              </View>

                              <View className="flex-1 gap-1.5">
                                <View className="flex-row items-center gap-2 flex-wrap">
                                  <View style={{ backgroundColor: `${meta?.color}22` }} className="h-6 w-6 items-center justify-center rounded-full">
                                    <MaterialCommunityIcons name={meta?.mcIcon || 'help-circle-outline'} size={16} color={meta?.color || '#64748b'} />
                                  </View>
                                  <Text className={`text-[15px] font-bold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
                                    {meta?.label || topClass || 'Unknown'}
                                  </Text>
                                  {isValid && badge && (
                                    <View className={`rounded-full border px-2 py-0.5 ${isDark ? `${badge.borderDark} ${badge.bgDark}` : `${badge.borderLight} ${badge.bgLight}`}`}>
                                      <Text className={`text-[10px] font-semibold ${isDark ? badge.textDark : badge.textLight}`}>
                                        {badge.label}
                                      </Text>
                                    </View>
                                  )}
                                </View>

                                {isValid && (
                                  <View className="flex-row items-center gap-1.5">
                                    <Feather name="bar-chart-2" size={12} color={isDark ? '#94a3b8' : '#64748b'} />
                                    <Text className={`text-[12px] font-semibold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                                      {Math.round((Number(selectedScan.confidence) || 0) * 100)}% confidence
                                    </Text>
                                  </View>
                                )}

                                {isValid && (
                                  <View className="flex-row items-center gap-1.5">
                                    <MaterialCommunityIcons name="sigma" size={12} color={isDark ? '#94a3b8' : '#64748b'} />
                                    <Text className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                      Entropy {selectedScan.entropy ?? '--'} · Margin {selectedScan.margin != null ? Math.round(Number(selectedScan.margin) * 100) : '--'}%
                                    </Text>
                                  </View>
                                )}
                              </View>
                            </View>

                            {!isValid && (
                              <View className={`flex-row items-start gap-2.5 rounded-2xl border px-4 py-3 ${isDark ? 'border-amber-700/40 bg-amber-900/20' : 'border-amber-200 bg-amber-50'}`}>
                                <MaterialCommunityIcons
                                  name="alert-circle-outline"
                                  size={16}
                                  color={isDark ? '#fcd34d' : '#b45309'}
                                />
                                <Text className={`flex-1 text-[12px] leading-[18px] ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
                                  {rejectionReason || 'Image not recognized as a container'}
                                </Text>
                              </View>
                            )}

                            {severityNote(topClass, isValid) ? (
                              <View className={`flex-row items-start gap-2.5 rounded-2xl border px-4 py-3 ${isDark ? 'border-sky-900/50 bg-sky-950/30' : 'border-sky-100 bg-sky-50'}`}>
                                <Feather name="info" size={13} color={isDark ? '#7dd3fc' : '#0369a1'} />
                                <Text className={`flex-1 text-[12px] leading-[18px] ${isDark ? 'text-sky-200' : 'text-sky-800'}`}>
                                  {severityNote(topClass, isValid)}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        );
                      })()}
                    </View>
                  </View>

                  <View className={`rounded-[24px] border p-4 ${isDark ? 'border-sky-900/50 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}>
                    <View className="mb-3 flex-row items-center gap-2">
                      <MaterialCommunityIcons name="chart-bar" size={13} color={isDark ? '#38bdf8' : '#0284c7'} />
                      <Text className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                        Confidence Breakdown
                      </Text>
                    </View>
                    {Object.entries(CLASS_META)
                      .filter(([cls]) => cls !== 'Unknown')
                      .map(([cls, { color, label }]) => (
                        <ConfidenceBar
                          key={cls}
                          label={label}
                          value={Number(selectedScan?.probabilities?.[cls]) || 0}
                          color={color}
                          isDark={isDark}
                        />
                      ))}
                  </View>

                  <View className={`rounded-[24px] border p-5 ${isDark ? 'border-sky-900/60 bg-slate-950/50' : 'border-slate-200 bg-white'}`}>
                    <View className="mb-2 flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <MaterialCommunityIcons
                          name="robot-outline"
                          size={16}
                          color={isDark ? '#7dd3fc' : '#0284c7'}
                        />
                        <Text className={`text-[11px] font-semibold uppercase tracking-widest ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
                          Container Advisor
                        </Text>
                      </View>
                      <View className={`rounded-full border px-2 py-0.5 ${isDark ? 'border-sky-800/60' : 'border-sky-200'}`}>
                        <Text className={`text-[9px] font-semibold ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
                          AI
                        </Text>
                      </View>
                    </View>

                    <Text className={`mb-3 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
                      Based on class: {CLASS_META[selectedScan?.predicted_class || 'Unknown']?.label || selectedScan?.predicted_class || 'Unknown'}
                    </Text>

                    {advisorLoading ? (
                      <View className="items-center py-3">
                        <ActivityIndicator size="small" color={isDark ? '#38bdf8' : '#0284c7'} />
                        <Text className={`mt-2 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                          Generating cleaning guidance...
                        </Text>
                      </View>
                    ) : advisorError ? (
                      <Text className={`text-[11px] ${isDark ? 'text-red-300' : 'text-red-700'}`}>
                        {advisorError}
                      </Text>
                    ) : (
                      <Text className={`text-[12px] leading-[18px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        {formatAdvisorText(advisorText)}
                      </Text>
                    )}
                  </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
});

export default ContainerScanHistory;
