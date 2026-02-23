import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Animated,
} from 'react-native';
import LottieView from 'lottie-react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../utils/supabaseClient';
import { assessMicrobialRisk } from '../utils/api';
import WaterResultScreen from './WaterResultScreen';
import ContainerScanHistory from './ContainerScanHistory';
import { useAppTheme } from '../utils/theme';

const loadingAnim = require('../assets/public/loading.json');

const PAGE_SIZE = 10;

const SUPABASE_SAMPLES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_SAMPLES_TABLE || 'field_samples';
const DEFAULT_DECISION_THRESHOLD = 0.58;
const SAMPLE_SELECT_FIELDS =
  'id, created_at, source, sample_label, color, risk_level, prediction_probability, prediction_is_potable, model_version, anomaly_checks, microbial_risk, microbial_score, possible_bacteria, ph, hardness, solids, chloramines, sulfate, conductivity, organic_carbon, trihalomethanes, turbidity';

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

const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'timestamp unavailable';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'timestamp unavailable';
  return date.toLocaleString();
};

const buildPredictedClass = (row) => {
  if (typeof row?.prediction_is_potable !== 'boolean') {
    return row?.risk_level ? `Risk: ${row.risk_level}` : 'Prediction pending';
  }
  if (row.prediction_is_potable) {
    return row.risk_level ? `Potable (${row.risk_level})` : 'Potable';
  }
  return row.risk_level ? `Non-potable (${row.risk_level})` : 'Non-potable';
};

const deriveStatus = (row) => {
  const risk = (row?.risk_level || '').toLowerCase();
  if (risk === 'safe' || risk === 'borderline') return 'Cleared';
  if (risk === 'watch') return 'Review';
  if (risk === 'unsafe') return 'Alert';
  return 'Review';
};

const buildSummaryMessage = (row) => {
  if (row?.prediction_is_potable) {
    return row?.risk_level === 'safe'
      ? 'Sample matches potable water profile with strong confidence.'
      : 'Sample is marginally potable but monitor outlier parameters.';
  }
  return row?.risk_level === 'watch'
    ? 'Sample trends toward non-potable; investigate highlighted parameters.'
    : 'Sample is likely non-potable; escalate for confirmatory testing.';
};

const buildResultFromRow = (row) => ({
  isPotable: !!row?.prediction_is_potable,
  probability: Number.isFinite(row?.prediction_probability)
    ? Number(row.prediction_probability)
    : 0,
  decisionThreshold: DEFAULT_DECISION_THRESHOLD,
  riskLevel: row?.risk_level || 'unknown',
  modelVersion: row?.model_version || 'model',
  timestamp: row?.created_at || null,
  checks: Array.isArray(row?.anomaly_checks) ? row.anomaly_checks : [],
  missingFeatures: [],
  meta: {
    source: row?.source || null,
    color: row?.color || null,
    sampleLabel: row?.sample_label || null,
  },
  saved: true,
  sampleId: row?.id || null,
  message: buildSummaryMessage(row),
  // Microbial risk fields (stored in Supabase)
  microbialRiskLevel: row?.microbial_risk || null,
  microbialScore: Number.isFinite(row?.microbial_score) ? row.microbial_score : null,
  microbialMaxScore: 14,
  possibleBacteria: Array.isArray(row?.possible_bacteria) ? row.possible_bacteria : [],
});

const toDateBoundaryIso = (value, endOfDay = false) => {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [yearRaw, monthRaw, dayRaw] = normalized.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
};

const applySampleFilters = (query, selectedStartDate, selectedEndDate, selectedCategories) => {
  let filteredQuery = query;
  const startIso = toDateBoundaryIso(selectedStartDate, false);
  const endIso = toDateBoundaryIso(selectedEndDate, true);
  if (startIso) filteredQuery = filteredQuery.gte('created_at', startIso);
  if (endIso) filteredQuery = filteredQuery.lte('created_at', endIso);
  if (selectedCategories.length > 0) filteredQuery = filteredQuery.in('risk_level', selectedCategories);
  return filteredQuery;
};

const mapHistoryRow = (row) => ({
  id: row.id,
  timestamp: formatTimestamp(row.created_at),
  location: row.sample_label || row.source || 'Sample',
  predictedClass: buildPredictedClass(row),
  confidence: Number.isFinite(row.prediction_probability) ? Number(row.prediction_probability) : 0,
  status: deriveStatus(row),
  _raw: row,
});

const formatRiskCategoryLabel = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Unknown';
  return normalized
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const formatDateYmd = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseYmdToDate = (value) => {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [yearRaw, monthRaw, dayRaw] = normalized.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const PredictionHistoryScreen = ({ onNavigate }) => {
  const { isDark } = useAppTheme();
  const [activeTab, setActiveTab] = useState('data'); // 'data' | 'container'
  const [dataHistory, setDataHistory] = useState([]);
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');
  const [selectedStartDate, setSelectedStartDate] = useState('');
  const [selectedEndDate, setSelectedEndDate] = useState('');
  const [riskCategoryOptions, setRiskCategoryOptions] = useState([]);
  const [riskCategories, setRiskCategories] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState('start');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailResult, setDetailResult] = useState(null);
  const screenAnim = useRef(new Animated.Value(0)).current;
  const dataPageRef = useRef(0);
  const isMountedRef = useRef(true);
  const containerHistoryRef = useRef(null);
  const filterKey = `${selectedStartDate}|${selectedEndDate}|${riskCategories.slice().sort().join(',')}`;

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

  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    const fetchPage = async (page, isInitial) => {
      if (activeTab !== 'data') return;
      if (isInitial) setLoading(true);
      else setLoadingMore(true);

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      try {
        const sessionResult = await supabase.auth.getSession();
        const userId = sessionResult?.data?.session?.user?.id || null;
        if (!userId) {
          if (!cancelled) setDataHistory([]);
          return;
        }

        let query = supabase
          .from(SUPABASE_SAMPLES_TABLE)
          .select(SAMPLE_SELECT_FIELDS)
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        query = applySampleFilters(query, selectedStartDate, selectedEndDate, riskCategories);

        const { data, error } = await query.range(from, to);

        if (error) {
          console.warn('[Supabase] failed to load prediction history:', error.message || error);
          if (!cancelled && isInitial) setDataHistory([]);
          return;
        }

        const mapped = (data || []).map(mapHistoryRow);

        if (!cancelled) {
          if (isInitial) {
            setDataHistory(mapped);
          } else {
            setDataHistory((prev) => [...prev, ...mapped]);
          }
          setHasMore(mapped.length === PAGE_SIZE);
          dataPageRef.current = page + 1;
        }
      } catch (error) {
        console.warn('[Supabase] unexpected history load error:', error?.message || error);
        if (!cancelled && isInitial) setDataHistory([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    };

    dataPageRef.current = 0;
    setHasMore(true);
    fetchPage(0, true);

    return () => {
      cancelled = true;
      isMountedRef.current = false;
    };
  }, [activeTab, filterKey]);

  useEffect(() => {
    let cancelled = false;

    const fetchRiskCategoryOptions = async () => {
      if (activeTab !== 'data') return;

      try {
        const sessionResult = await supabase.auth.getSession();
        const userId = sessionResult?.data?.session?.user?.id || null;
        if (!userId) {
          if (!cancelled) {
            setRiskCategoryOptions([]);
            setRiskCategories([]);
          }
          return;
        }

        const { data, error } = await supabase
          .from(SUPABASE_SAMPLES_TABLE)
          .select('risk_level')
          .eq('user_id', userId)
          .not('risk_level', 'is', null)
          .order('created_at', { ascending: false })
          .limit(500);

        if (error || cancelled) return;

        const uniqueLevels = Array.from(
          new Set(
            (data || [])
              .map((row) => String(row?.risk_level || '').trim().toLowerCase())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));

        const options = uniqueLevels.map((level) => ({
          key: level,
          label: formatRiskCategoryLabel(level),
        }));

        setRiskCategoryOptions(options);
        setRiskCategories((prev) => prev.filter((selected) => uniqueLevels.includes(selected)));
      } catch {
        if (!cancelled) setRiskCategoryOptions([]);
      }
    };

    fetchRiskCategoryOptions();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const items = dataHistory;

  const handleScrollNearEnd = ({ nativeEvent }) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 120;
    if (!isNearBottom) return;
    if (activeTab === 'data' && hasMore && !loadingMore && !loading) {
      setLoadingMore(true);
      const from = dataPageRef.current * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      (async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const userId = sessionData?.session?.user?.id || null;
          if (!userId || !isMountedRef.current) return;

          let query = supabase
            .from(SUPABASE_SAMPLES_TABLE)
            .select(SAMPLE_SELECT_FIELDS)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

          query = applySampleFilters(query, selectedStartDate, selectedEndDate, riskCategories);

          const { data, error } = await query.range(from, to);
          if (error || !isMountedRef.current) return;

          const mapped = (data || []).map(mapHistoryRow);
          setDataHistory((prev) => [...prev, ...mapped]);
          setHasMore(mapped.length === PAGE_SIZE);
          dataPageRef.current += 1;
        } finally {
          if (isMountedRef.current) setLoadingMore(false);
        }
      })();
    } else if (activeTab === 'container') {
      containerHistoryRef.current?.loadMore?.();
    }
  };

  const toggleRiskCategory = (categoryKey) => {
    setRiskCategories((prev) => {
      if (prev.includes(categoryKey)) return prev.filter((value) => value !== categoryKey);
      return [...prev, categoryKey];
    });
  };

  const hasActiveFilters = Boolean(selectedStartDate) || Boolean(selectedEndDate) || riskCategories.length > 0;

  const hasPendingDateChanges =
    startDateInput.trim() !== selectedStartDate || endDateInput.trim() !== selectedEndDate;

  const openDatePicker = (target) => {
    setPickerTarget(target);
    setPickerVisible(true);
  };

  const handlePickerChange = (_event, pickedDate) => {
    if (Platform.OS !== 'ios') setPickerVisible(false);
    if (!pickedDate) return;
    const ymd = formatDateYmd(pickedDate);
    if (!ymd) return;
    if (pickerTarget === 'start') setStartDateInput(ymd);
    else setEndDateInput(ymd);
  };

  const activePickerValue =
    parseYmdToDate(pickerTarget === 'start' ? startDateInput : endDateInput) || new Date();

  const applyDateRange = () => {
    const nextStart = startDateInput.trim();
    const nextEnd = endDateInput.trim();
    setSelectedStartDate(nextStart);
    setSelectedEndDate(nextEnd);
  };

  const resetFilters = () => {
    setStartDateInput('');
    setEndDateInput('');
    setSelectedStartDate('');
    setSelectedEndDate('');
    setRiskCategories([]);
  };

  const getConfidenceColor = (pct) => {
    if (pct >= 80) return { bar: 'bg-emerald-500', text: isDark ? 'text-emerald-300' : 'text-emerald-600' };
    if (pct >= 65) return { bar: 'bg-sky-400',     text: isDark ? 'text-sky-300'     : 'text-sky-600'     };
    if (pct >= 45) return { bar: 'bg-amber-400',   text: isDark ? 'text-amber-300'   : 'text-amber-600'   };
    return               { bar: 'bg-rose-500',     text: isDark ? 'text-rose-300'    : 'text-rose-600'    };
  };

  const renderCard = (item) => {
    const statusClass = getStatusStyleClass(item.status, isDark);
    const statusTextClass = getStatusTextClass(item.status, isDark);
    const cardBorderClass = getCardBorderClass(item.status, isDark);
    const canShowDetails = true;
    const confidencePct = Math.min(100, Math.max(5, item.confidence * 100));
    const confColor = getConfidenceColor(confidencePct);

    return (
      <View
        key={item.id}
        className={`mb-3 rounded-2xl border p-4 ${cardBorderClass} ${isDark ? 'bg-slate-900/70' : 'bg-white'}`}
      >
        {/* Row 1 — location + status badge */}
        <View className="flex-row items-center justify-between">
          <View className="flex-1 flex-row items-center gap-2.5 pr-3">
            <View className={`h-8 w-8 items-center justify-center rounded-xl ${
              item.status === 'Cleared' ? (isDark ? 'bg-emerald-500/15' : 'bg-emerald-100') :
              item.status === 'Alert'   ? (isDark ? 'bg-rose-500/15'    : 'bg-rose-100')    :
                                          (isDark ? 'bg-amber-500/15'   : 'bg-amber-100')
            }`}>
              <MaterialCommunityIcons
                name={
                  item.status === 'Cleared' ? 'water-check' :
                  item.status === 'Alert'   ? 'water-alert' :
                                              'water-minus'
                }
                size={16}
                color={
                  item.status === 'Cleared' ? '#22c55e' :
                  item.status === 'Alert'   ? '#ef4444' :
                                              '#f59e0b'
                }
              />
            </View>
            <View className="flex-1">
              <Text className={`text-[15px] font-semibold leading-snug ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
                {item.location}
              </Text>
              <View className="flex-row items-center gap-1 mt-0.5">
                <Feather name="clock" size={9} color={isDark ? '#475569' : '#94a3b8'} />
                <Text className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  {item.timestamp}
                </Text>
              </View>
            </View>
          </View>
          <View className={`rounded-full border px-3 py-1 ${statusClass}`}>
            <Text className={`text-[11px] font-semibold ${statusTextClass}`}>
              {item.status}
            </Text>
          </View>
        </View>

        {/* Row 2 — predicted class + confidence */}
        <View className="mt-3 flex-row items-end justify-between">
          <View className="flex-1 flex-row items-center gap-1.5 pr-4">
            <Feather
              name={item.predictedClass.toLowerCase().includes('potable') && !item.predictedClass.toLowerCase().includes('non') ? 'check-circle' : 'alert-circle'}
              size={12}
              color={item.predictedClass.toLowerCase().includes('potable') && !item.predictedClass.toLowerCase().includes('non') ? '#22c55e' : '#f97316'}
            />
            <Text className={`text-[13px] ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              {item.predictedClass}
            </Text>
          </View>
          <Text className={`text-[20px] font-bold tabular-nums ${confColor.text}`}>
            {confidencePct.toFixed(0)}
            <Text className={`text-[12px] font-normal ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>%</Text>
          </Text>
        </View>

        {/* Confidence bar */}
        <View className={`mt-2 h-1 w-full rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
          <View
            className={`h-full rounded-full ${confColor.bar}`}
            style={{ width: `${confidencePct}%` }}
          />
        </View>

        {/* Row 3 — action */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={async () => {             
            if (canShowDetails) {
              const row = item._raw;
              let result = buildResultFromRow(row);

              if (!result.microbialRiskLevel && row) {
                try {
                  const sample = {
                    ph: row.ph ?? null,
                    hardness: row.hardness ?? null,
                    solids: row.solids ?? null,
                    chloramines: row.chloramines ?? null,
                    sulfate: row.sulfate ?? null,
                    conductivity: row.conductivity ?? null,
                    organicCarbon: row.organic_carbon ?? null,
                    trihalomethanes: row.trihalomethanes ?? null,
                    turbidity: row.turbidity ?? null,
                  };
                  const microbial = await assessMicrobialRisk(sample);
                  if (microbial?.microbialRiskLevel) {
                    result = {
                      ...result,
                      microbialRiskLevel: microbial.microbialRiskLevel,
                      microbialRiskProbabilities: microbial.microbialRiskProbabilities || {},
                      microbialScore: microbial.microbialScore ?? null,
                      microbialMaxScore: microbial.microbialMaxScore ?? 14,
                      microbialViolations: microbial.microbialViolations || [],
                      possibleBacteria: microbial.possibleBacteria || [],
                    };
                  }
                } catch (e) {
                  console.warn('[History] on-the-fly microbial assessment failed:', e?.message);
                }
              }

              setDetailResult(result);
              setDetailVisible(true);
            }
          }}
          className={`mt-3 rounded-xl py-2.5 flex-row items-center justify-center gap-2 ${isDark ? 'bg-sky-900/40' : 'bg-slate-100'}`}
        >
          <Feather name="file-text" size={12} color={isDark ? '#7dd3fc' : '#475569'} />
          <Text className={`text-[12px] font-semibold ${isDark ? 'text-sky-200' : 'text-slate-700'}`}>
            View Full Report
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      className={`flex-1 ${isDark ? 'bg-aquadark' : 'bg-slate-100'}`}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <WaterResultScreen
        visible={detailVisible && Boolean(detailResult)}
        result={detailResult}
        onClose={() => setDetailVisible(false)}
      />
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
      <View className="px-5 pt-10 pb-4">
        {/* Back button */}
        <TouchableOpacity
          activeOpacity={0.8}
          className="mb-5 self-start flex-row items-center gap-1.5"
          onPress={() => onNavigate && onNavigate('home')}
        >
          <Feather name="chevron-left" size={15} color={isDark ? '#38bdf8' : '#0284c7'} />
          <Text className={`text-[13px] font-semibold ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>Dashboard</Text>
        </TouchableOpacity>

        {/* Header */}
        <View className="flex-row items-center gap-3 mb-1">
          <View className={`h-10 w-10 items-center justify-center rounded-2xl ${isDark ? 'bg-sky-500/15' : 'bg-sky-100'}`}>
            <MaterialCommunityIcons name="clipboard-text-clock-outline" size={20} color={isDark ? '#38bdf8' : '#0284c7'} />
          </View>
          <View>
            <Text className={`text-[22px] font-bold leading-tight ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
              Analysis Records
            </Text>
            <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Water quality &amp; container scan history
            </Text>
          </View>
        </View>

        {/* Count pill */}
        {activeTab === 'data' && items.length > 0 && (
          <View className={`mt-3 mb-1 self-start flex-row items-center gap-1.5 rounded-full border px-3 py-1 ${
            isDark ? 'border-sky-800/60 bg-sky-900/30' : 'border-sky-200 bg-sky-50'
          }`}>
            <Feather name="layers" size={10} color={isDark ? '#7dd3fc' : '#0284c7'} />
            <Text className={`text-[10px] font-semibold ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
              {items.length} record{items.length !== 1 ? 's' : ''}
            </Text>
          </View>
        )}

        {/* Tab switcher */}
        <View className={`mt-4 rounded-2xl p-1 flex-row ${isDark ? 'bg-slate-950/70' : 'bg-slate-200'}`}>
          <TouchableOpacity
            activeOpacity={0.9}
            className={`flex-1 rounded-xl px-3 py-2 flex-row items-center justify-center gap-1.5 ${
              activeTab === 'data' ? (isDark ? 'bg-sky-500/20' : 'bg-white') : 'bg-transparent'
            }`}
            onPress={() => setActiveTab('data')}
          >
            <MaterialCommunityIcons
              name="water-check-outline"
              size={14}
              color={activeTab === 'data' ? (isDark ? '#7dd3fc' : '#0284c7') : (isDark ? '#475569' : '#94a3b8')}
            />
            <Text
              className={`text-[12px] font-semibold ${
                activeTab === 'data' ? (isDark ? 'text-sky-200' : 'text-sky-700') : (isDark ? 'text-slate-500' : 'text-slate-500')
              }`}
            >
              Water Samples
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.9}
            className={`flex-1 rounded-xl px-3 py-2 flex-row items-center justify-center gap-1.5 ${
              activeTab === 'container' ? (isDark ? 'bg-sky-500/20' : 'bg-white') : 'bg-transparent'
            }`}
            onPress={() => setActiveTab('container')}
          >
            <MaterialCommunityIcons
              name="cup-water"
              size={14}
              color={activeTab === 'container' ? (isDark ? '#7dd3fc' : '#0284c7') : (isDark ? '#475569' : '#94a3b8')}
            />
            <Text
              className={`text-[12px] font-semibold ${
                activeTab === 'container' ? (isDark ? 'text-sky-200' : 'text-sky-700') : (isDark ? 'text-slate-500' : 'text-slate-500')
              }`}
            >
              Containers
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'data' && (
          <View className={`mt-3 rounded-2xl border overflow-hidden ${isDark ? 'border-slate-800 bg-slate-950/70' : 'border-slate-200 bg-white'}`}>

            {/* ── Collapsible header ── */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setFilterOpen((prev) => !prev)}
              className={`flex-row items-center justify-between px-4 py-3 ${filterOpen ? (isDark ? 'bg-sky-950/60' : 'bg-sky-50') : 'bg-transparent'}`}
            >
              <View className="flex-row items-center gap-2">
                <View className={`h-6 w-6 items-center justify-center rounded-lg ${isDark ? 'bg-sky-500/20' : 'bg-sky-100'}`}>
                  <Feather name="sliders" size={12} color={isDark ? '#7dd3fc' : '#0284c7'} />
                </View>
                <Text className={`text-[13px] font-bold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
                  Filters
                </Text>
                {hasActiveFilters ? (
                  <View className={`rounded-full min-w-[18px] px-1.5 py-0.5 items-center ${isDark ? 'bg-sky-500/30' : 'bg-sky-500'}`}>
                    <Text className="text-[10px] font-bold text-white">
                      {(selectedStartDate || selectedEndDate ? 1 : 0) + riskCategories.length}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View className="flex-row items-center gap-2.5">
                {hasActiveFilters ? (
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation?.(); resetFilters(); }}
                    hitSlop={{ top: 8, bottom: 8, left: 10, right: 10 }}
                    activeOpacity={0.8}
                    className={`flex-row items-center gap-1 rounded-full px-2 py-0.5 ${isDark ? 'bg-rose-500/15' : 'bg-rose-50'}`}
                  >
                    <Feather name="x" size={10} color={isDark ? '#fb7185' : '#f43f5e'} />
                    <Text className={`text-[10px] font-semibold ${isDark ? 'text-rose-400' : 'text-rose-500'}`}>
                      Clear
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <Feather
                  name={filterOpen ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={isDark ? '#64748b' : '#94a3b8'}
                />
              </View>
            </TouchableOpacity>

            {/* ── Expanded body ── */}
            {filterOpen ? (
              <View className={`px-4 pb-4 pt-3 ${isDark ? 'border-t border-slate-800' : 'border-t border-slate-100'}`}>

                {/* Date Range */}
                <View className="flex-row items-center gap-1.5 mb-2.5">
                  <MaterialCommunityIcons name="calendar-range" size={13} color={isDark ? '#94a3b8' : '#64748b'} />
                  <Text className={`text-[11px] font-bold uppercase tracking-wide ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Date Range
                  </Text>
                </View>

                <View className="flex-row items-center gap-2">
                  {/* From */}
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => openDatePicker('start')}
                    className={`flex-1 rounded-2xl border px-3 py-2.5 ${
                      startDateInput
                        ? (isDark ? 'border-sky-600/60 bg-sky-900/40' : 'border-sky-300 bg-sky-50')
                        : (isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50')
                    }`}
                  >
                    <View className="flex-row items-center gap-1.5 mb-0.5">
                      <Feather name="calendar" size={10} color={isDark ? '#64748b' : '#94a3b8'} />
                      <Text className={`text-[9px] font-semibold uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>From</Text>
                    </View>
                    <Text className={`text-[13px] font-semibold ${
                      startDateInput ? (isDark ? 'text-sky-200' : 'text-sky-700') : (isDark ? 'text-slate-500' : 'text-slate-400')
                    }`}>
                      {startDateInput || 'Start date'}
                    </Text>
                  </TouchableOpacity>

                  {/* Arrow */}
                  <View className={`h-6 w-6 items-center justify-center rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                    <Feather name="arrow-right" size={11} color={isDark ? '#475569' : '#94a3b8'} />
                  </View>

                  {/* To */}
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => openDatePicker('end')}
                    className={`flex-1 rounded-2xl border px-3 py-2.5 ${
                      endDateInput
                        ? (isDark ? 'border-sky-600/60 bg-sky-900/40' : 'border-sky-300 bg-sky-50')
                        : (isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50')
                    }`}
                  >
                    <View className="flex-row items-center gap-1.5 mb-0.5">
                      <Feather name="calendar" size={10} color={isDark ? '#64748b' : '#94a3b8'} />
                      <Text className={`text-[9px] font-semibold uppercase ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>To</Text>
                    </View>
                    <Text className={`text-[13px] font-semibold ${
                      endDateInput ? (isDark ? 'text-sky-200' : 'text-sky-700') : (isDark ? 'text-slate-500' : 'text-slate-400')
                    }`}>
                      {endDateInput || 'End date'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Apply button — shown only when there are pending changes */}
                {hasPendingDateChanges ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={applyDateRange}
                    className={`mt-3 rounded-2xl py-2.5 flex-row items-center justify-center gap-2 ${isDark ? 'bg-sky-600/30' : 'bg-sky-500'}`}
                  >
                    <Feather name="check" size={13} color={isDark ? '#7dd3fc' : '#ffffff'} />
                    <Text className={`text-[12px] font-bold ${isDark ? 'text-sky-200' : 'text-white'}`}>
                      Apply Date Range
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {/* Native date picker */}
                {pickerVisible ? (
                  <View className={`mt-3 rounded-2xl overflow-hidden ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
                    <DateTimePicker
                      value={activePickerValue}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={handlePickerChange}
                      maximumDate={new Date()}
                    />
                    {Platform.OS === 'ios' ? (
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => setPickerVisible(false)}
                        className={`mx-3 mb-3 rounded-xl py-2 items-center ${isDark ? 'bg-sky-600/30' : 'bg-sky-500'}`}
                      >
                        <Text className={`text-[12px] font-bold ${isDark ? 'text-sky-200' : 'text-white'}`}>Done</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}

                {/* ── Divider ── */}
                <View className={`my-3.5 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`} />

                {/* Categories */}
                <View className="flex-row items-center gap-1.5 mb-2.5">
                  <MaterialCommunityIcons name="tag-multiple-outline" size={13} color={isDark ? '#94a3b8' : '#64748b'} />
                  <Text className={`text-[11px] font-bold uppercase tracking-wide ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Risk Category
                  </Text>
                </View>

                {riskCategoryOptions.length === 0 ? (
                  <View className={`rounded-2xl border border-dashed py-3 items-center ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                    <MaterialCommunityIcons name="tag-off-outline" size={18} color={isDark ? '#475569' : '#cbd5e1'} />
                    <Text className={`mt-1 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      No categories yet
                    </Text>
                  </View>
                ) : (
                  <View className="flex-row flex-wrap gap-2">
                    {riskCategoryOptions.map((option) => {
                      const selected = riskCategories.includes(option.key);
                      const k = option.key.toLowerCase();
                      const iconName =
                        k === 'safe'       ? 'check-circle'    :
                        k === 'borderline' ? 'minus-circle'    :
                        k === 'watch'      ? 'alert-circle'    :
                        k === 'unsafe'     ? 'x-circle'        : 'circle';
                      const iconColor = selected
                        ? '#ffffff'
                        : k === 'safe'       ? '#22c55e'
                        : k === 'borderline' ? '#f59e0b'
                        : k === 'watch'      ? '#f97316'
                        : k === 'unsafe'     ? '#ef4444'
                        : (isDark ? '#64748b' : '#94a3b8');
                      const chipBg = selected
                        ? k === 'safe'       ? 'bg-emerald-500'
                        : k === 'borderline' ? 'bg-amber-500'
                        : k === 'watch'      ? 'bg-orange-500'
                        : k === 'unsafe'     ? 'bg-rose-500'
                        : (isDark ? 'bg-sky-600' : 'bg-sky-500')
                        : (isDark ? 'bg-slate-900' : 'bg-slate-50');
                      const chipBorder = selected
                        ? 'border-transparent'
                        : k === 'safe'       ? (isDark ? 'border-emerald-700/60' : 'border-emerald-200')
                        : k === 'borderline' ? (isDark ? 'border-amber-700/60'   : 'border-amber-200')
                        : k === 'watch'      ? (isDark ? 'border-orange-700/60'  : 'border-orange-200')
                        : k === 'unsafe'     ? (isDark ? 'border-rose-700/60'    : 'border-rose-200')
                        : (isDark ? 'border-slate-700' : 'border-slate-200');
                      const labelColor = selected
                        ? 'text-white'
                        : k === 'safe'       ? (isDark ? 'text-emerald-400' : 'text-emerald-700')
                        : k === 'borderline' ? (isDark ? 'text-amber-400'   : 'text-amber-700')
                        : k === 'watch'      ? (isDark ? 'text-orange-400'  : 'text-orange-700')
                        : k === 'unsafe'     ? (isDark ? 'text-rose-400'    : 'text-rose-700')
                        : (isDark ? 'text-slate-400' : 'text-slate-600');
                      return (
                        <TouchableOpacity
                          key={option.key}
                          activeOpacity={0.8}
                          onPress={() => toggleRiskCategory(option.key)}
                          className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${chipBg} ${chipBorder}`}
                        >
                          <Feather name={iconName} size={11} color={iconColor} />
                          <Text className={`text-[11px] font-semibold ${labelColor}`}>
                            {option.label}
                          </Text>
                          {selected ? (
                            <Feather name="check" size={10} color="#ffffff" />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            ) : null}
          </View>
        )}
      </View>

      <ScrollView
        className="px-5"
        contentContainerClassName="pb-28 pt-1"
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollNearEnd}
        scrollEventThrottle={16}
      >
        <View className="mt-2">
          {activeTab === 'data' && loading ? (
            <View className="items-center py-8">
              <LottieView
                source={loadingAnim}
                autoPlay
                loop
                style={{ width: 80, height: 80 }}
              />
              <Text className={`mt-2 text-[12px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                Loading samples…
              </Text>
            </View>
          ) : null}
          {activeTab === 'data' && !loading && items.length === 0 ? (
            <View className={`rounded-2xl border p-4 ${isDark ? 'border-sky-900/70 bg-sky-950/40' : 'border-slate-300 bg-slate-50'}`}>
              <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                No saved samples yet. Run a new check to populate history.
              </Text>
            </View>
          ) : null}
          {activeTab === 'data' ? items.map(renderCard) : <ContainerScanHistory ref={containerHistoryRef} isDark={isDark} active={activeTab === 'container'} />}
          {activeTab === 'data' && loadingMore && (
            <View className="items-center py-6">
              <LottieView source={loadingAnim} autoPlay loop style={{ width: 64, height: 64 }} />
            </View>
          )}
        </View>
      </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

export default PredictionHistoryScreen;
