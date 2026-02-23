import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Animated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { LineChart, BarChart, PieChart } from 'react-native-chart-kit';
import { supabase } from '../utils/supabaseClient';
import { useAppTheme } from '../utils/theme';

const SUPABASE_SAMPLES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_SAMPLES_TABLE || 'field_samples';
const CHART_WIDTH = Math.max(280, Dimensions.get('window').width - 58);
const CHART_HEIGHT = 210;

const buildChartConfig = (isDark) => ({
  backgroundGradientFrom: isDark ? '#020617' : '#f8fafc',
  backgroundGradientTo: isDark ? '#020617' : '#f8fafc',
  decimalPlaces: 2,
  color: (opacity = 1) => isDark
    ? `rgba(125, 211, 252, ${opacity})`
    : `rgba(2, 132, 199, ${opacity})`,
  labelColor: (opacity = 1) => isDark
    ? `rgba(148, 163, 184, ${opacity})`
    : `rgba(71, 85, 105, ${opacity})`,
  propsForDots: {
    r: '3',
    strokeWidth: '1.5',
    stroke: isDark ? '#0f172a' : '#e2e8f0',
  },
  propsForBackgroundLines: {
    stroke: isDark ? 'rgba(51, 65, 85, 0.55)' : 'rgba(203, 213, 225, 0.7)',
    strokeWidth: 1,
  },
  fillShadowGradient: isDark ? '#22d3ee' : '#0ea5e9',
  fillShadowGradientOpacity: isDark ? 0.14 : 0.1,
});

const numeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatPercent = (value) => {
  if (!Number.isFinite(value)) return '--';
  return `${Math.round(value * 100)}%`;
};

const average = (values = []) => {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const median = (values = []) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const compactDateLabel = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const compactTimeLabel = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
};

const riskToScore = (risk = '') => {
  const normalized = String(risk || '').toLowerCase();
  if (normalized === 'safe') return 0.15;
  if (normalized === 'borderline') return 0.35;
  if (normalized === 'watch') return 0.65;
  if (normalized === 'unsafe') return 0.88;
  return 0.5;
};

const riskToStatus = (risk = '') => {
  const normalized = String(risk || '').toLowerCase();
  if (normalized === 'safe' || normalized === 'borderline') return 'Cleared';
  if (normalized === 'watch') return 'Review';
  if (normalized === 'unsafe') return 'Alert';
  return 'Review';
};

const describePh = (value) => {
  if (!Number.isFinite(value)) return 'No data';
  if (value < 6.5) return 'Acidic';
  if (value > 8.5) return 'Alkaline';
  return 'Balanced';
};

const describeTurbidity = (value) => {
  if (!Number.isFinite(value)) return 'No data';
  if (value <= 1) return 'Very clear';
  if (value <= 5) return 'Acceptable';
  return 'Elevated';
};

const describeConductivity = (value) => {
  if (!Number.isFinite(value)) return 'No data';
  if (value < 250) return 'Low mineral load';
  if (value <= 600) return 'Moderate mineral load';
  return 'High mineral load';
};

const describeHardness = (value) => {
  if (!Number.isFinite(value)) return 'No data';
  if (value < 60) return 'Soft';
  if (value <= 120) return 'Moderate';
  if (value <= 180) return 'Hard';
  return 'Very hard';
};

const buildRecentDayBuckets = (samples, days = 7) => {
  const buckets = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    buckets.push({ key, date, count: 0 });
  }

  samples.forEach((row) => {
    const date = row?.created_at ? new Date(row.created_at) : null;
    if (!date || Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const target = buckets.find((bucket) => bucket.key === key);
    if (target) target.count += 1;
  });

  return buckets;
};

const AnalysisScreen = ({ onNavigate }) => {
  const { isDark } = useAppTheme();
  const chartConfig = buildChartConfig(isDark);
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const screenAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(screenAnim, {
      toValue: 1,
      duration: 450,
      delay: 50,
      useNativeDriver: true,
    }).start();
  }, [screenAnim]);

  useEffect(() => {
    let isMounted = true;

    const loadAnalytics = async () => {
      setLoading(true);
      setError('');
      try {
        const sessionResult = await supabase.auth.getSession();
        const userId = sessionResult?.data?.session?.user?.id || null;

        if (!userId) {
          if (isMounted) {
            setSamples([]);
          }
          return;
        }

        const { data, error: queryError } = await supabase
          .from(SUPABASE_SAMPLES_TABLE)
          .select('id, created_at, source, risk_level, prediction_probability, prediction_is_potable, ph, turbidity, conductivity, hardness, solids, chloramines, sulfate, organic_carbon, trihalomethanes, microbial_risk, microbial_score')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(120);

        if (queryError) {
          throw queryError;
        }

        if (isMounted) {
          setSamples(data || []);
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(fetchError?.message || 'Unable to load analytics data.');
          setSamples([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadAnalytics();

    return () => {
      isMounted = false;
    };
  }, []);

  const analytics = useMemo(() => {
    const total = samples.length;
    const potableCount = samples.filter((row) => row?.prediction_is_potable === true).length;
    const watchOrUnsafe = samples.filter((row) => {
      const risk = String(row?.risk_level || '').toLowerCase();
      return risk === 'watch' || risk === 'unsafe';
    }).length;

    const probabilityValues = samples
      .map((row) => numeric(row?.prediction_probability))
      .filter((value) => Number.isFinite(value));

    const avgProbability = average(probabilityValues);
    const medianProbability = median(probabilityValues);

    // All samples (oldest → newest) for full-history trend charts
    const recent = [...samples].reverse();
    const trendLabels = recent.map((row) => compactDateLabel(row?.created_at));
    // Give each data point 56px so the chart is always readable when scrolled
    const trendChartWidth = Math.max(CHART_WIDTH, recent.length * 56);

    const confidenceTrend = {
      labels: trendLabels,
      datasets: [
        {
          data: recent.map((row) => {
            const value = numeric(row?.prediction_probability);
            return Number.isFinite(value) ? Number(value) : 0;
          }),
          color: (opacity = 1) => `rgba(34, 211, 238, ${opacity})`,
          strokeWidth: 2,
        },
      ],
      legend: ['Model confidence (0 – 1)'],
    };

    const riskTrend = {
      labels: trendLabels,
      datasets: [
        {
          data: recent.map((row) => riskToScore(row?.risk_level)),
          color: (opacity = 1) => `rgba(244, 114, 182, ${opacity})`,
          strokeWidth: 2,
        },
      ],
      legend: ['Risk score (safe 0.15 → unsafe 0.88)'],
    };

    const dayBuckets = buildRecentDayBuckets(samples, 7);
    const volumeByDay = {
      labels: dayBuckets.map((bucket) => compactDateLabel(bucket.date)),
      datasets: [
        {
          data: dayBuckets.map((bucket) => bucket.count),
        },
      ],
    };
    const volumeChartWidth = Math.max(CHART_WIDTH, dayBuckets.length * 68);

    const statusCounts = { Cleared: 0, Review: 0, Alert: 0 };
    samples.forEach((row) => {
      const status = riskToStatus(row?.risk_level);
      statusCounts[status] += 1;
    });

    const statusDistribution = [
      {
        name: 'Cleared',
        population: statusCounts.Cleared,
        color: '#34d399',
        legendFontColor: '#cbd5e1',
        legendFontSize: 11,
      },
      {
        name: 'Review',
        population: statusCounts.Review,
        color: '#fbbf24',
        legendFontColor: '#cbd5e1',
        legendFontSize: 11,
      },
      {
        name: 'Alert',
        population: statusCounts.Alert,
        color: '#fb7185',
        legendFontColor: '#cbd5e1',
        legendFontSize: 11,
      },
    ].filter((item) => item.population > 0);

    const phValues = samples.map((row) => numeric(row?.ph)).filter((value) => Number.isFinite(value));
    const turbidityValues = samples.map((row) => numeric(row?.turbidity)).filter((value) => Number.isFinite(value));
    const conductivityValues = samples.map((row) => numeric(row?.conductivity)).filter((value) => Number.isFinite(value));
    const hardnessValues = samples.map((row) => numeric(row?.hardness)).filter((value) => Number.isFinite(value));

    const parameterCards = [
      {
        key: 'ph',
        label: 'pH',
        avg: average(phValues),
        median: median(phValues),
        descriptor: describePh(average(phValues)),
      },
      {
        key: 'turbidity',
        label: 'Turbidity',
        avg: average(turbidityValues),
        median: median(turbidityValues),
        descriptor: describeTurbidity(average(turbidityValues)),
      },
      {
        key: 'conductivity',
        label: 'Conductivity',
        avg: average(conductivityValues),
        median: median(conductivityValues),
        descriptor: describeConductivity(average(conductivityValues)),
      },
      {
        key: 'hardness',
        label: 'Hardness',
        avg: average(hardnessValues),
        median: median(hardnessValues),
        descriptor: describeHardness(average(hardnessValues)),
      },
    ];

    const microbialCounts = { low: 0, medium: 0, high: 0, unknown: 0 };
    samples.forEach((row) => {
      const risk = String(row?.microbial_risk || '').toLowerCase();
      if (risk === 'low' || risk === 'medium' || risk === 'high') {
        microbialCounts[risk] += 1;
      } else {
        microbialCounts.unknown += 1;
      }
    });

    const insights = [];
    if (!total) {
      insights.push('No saved samples yet. Submit samples from Data Input to unlock analytics trends.');
    } else {
      insights.push(`You have ${total} saved samples with ${formatPercent(total ? potableCount / total : 0)} potable outcomes.`);
      insights.push(`Watch/unsafe samples count is ${watchOrUnsafe}, useful for targeted follow-up checks.`);
      if (Number.isFinite(avgProbability)) {
        insights.push(`Average model confidence is ${formatPercent(avgProbability)} (median ${formatPercent(medianProbability || 0)}).`);
      }
      const phAvg = average(phValues);
      if (Number.isFinite(phAvg)) {
        insights.push(`pH trend is ${describePh(phAvg).toLowerCase()} with average ${phAvg.toFixed(2)}.`);
      }
      const turbidityAvg = average(turbidityValues);
      if (Number.isFinite(turbidityAvg)) {
        insights.push(`Turbidity is ${describeTurbidity(turbidityAvg).toLowerCase()} at ${turbidityAvg.toFixed(2)} NTU average.`);
      }
    }

    return {
      total,
      potableCount,
      watchOrUnsafe,
      avgProbability,
      confidenceTrend,
      riskTrend,
      trendChartWidth,
      recentCount: recent.length,
      volumeByDay,
      volumeChartWidth,
      statusDistribution,
      parameterCards,
      microbialCounts,
      insights,
    };
  }, [samples]);

  const hasChartData = analytics.total > 0;
  const riskDistTotal = analytics.statusDistribution.reduce((sum, row) => sum + row.population, 0);

  return (
    <Animated.View
      className={`flex-1 ${isDark ? 'bg-aquadark' : 'bg-slate-100'}`}
      style={{
        opacity: screenAnim,
        transform: [
          {
            translateY: screenAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [18, 0],
            }),
          },
        ],
      }}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
        <Text className={`text-[22px] font-bold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>Analysis & trends</Text>
        <Text className={`mt-1 text-[13px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Comprehensive analytics built from your saved sample history.
        </Text>
      </View>

      <ScrollView
        className="px-5"
        contentContainerClassName="pb-28 gap-4"
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View className={`mt-8 items-center justify-center rounded-2xl border p-6 ${isDark ? 'border-sky-900/70 bg-slate-950/70' : 'border-slate-300 bg-white'}`}>
            <ActivityIndicator size="small" color={isDark ? '#7dd3fc' : '#0ea5e9'} />
            <Text className={`mt-3 text-[12px] ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Loading analytics...</Text>
          </View>
        ) : (
          <>
            {!!error && (
              <View className={`mt-1 rounded-2xl border p-4 ${isDark ? 'border-rose-500/60 bg-rose-900/15' : 'border-rose-300 bg-rose-50'}`}>
                <Text className={`text-[12px] font-semibold ${isDark ? 'text-rose-200' : 'text-rose-700'}`}>Analytics load issue</Text>
                <Text className={`mt-1 text-[12px] ${isDark ? 'text-rose-100/90' : 'text-rose-600'}`}>{error}</Text>
              </View>
            )}

            <View className={`mt-1 rounded-2xl border overflow-hidden ${isDark ? 'border-sky-900/70 bg-slate-950/75' : 'border-slate-200 bg-white'}`}>
              <View className={`px-4 py-3 border-b ${isDark ? 'border-sky-900/50 bg-slate-900/60' : 'border-slate-100 bg-slate-50'}`}>
                <Text className={`text-[12px] font-bold uppercase tracking-widest ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                  Overview
                </Text>
                <Text className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Summary of your saved water samples</Text>
              </View>
              <View className="p-4 gap-3">
                <View className="flex-row gap-3">
                  <View className={`flex-1 rounded-2xl overflow-hidden border ${isDark ? 'border-slate-800/80 bg-slate-900/80' : 'border-slate-200 bg-slate-50'}`}>
                    <View className="h-1 bg-sky-400" />
                    <View className="p-3">
                      <Text className={`text-[10px] uppercase tracking-wide font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Saved samples</Text>
                      <Text className={`mt-1 text-[24px] font-bold ${isDark ? 'text-sky-50' : 'text-slate-800'}`}>{analytics.total}</Text>
                    </View>
                  </View>
                  <View className={`flex-1 rounded-2xl overflow-hidden border ${isDark ? 'border-slate-800/80 bg-slate-900/80' : 'border-slate-200 bg-slate-50'}`}>
                    <View className="h-1 bg-emerald-400" />
                    <View className="p-3">
                      <Text className={`text-[10px] uppercase tracking-wide font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Potable rate</Text>
                      <Text className={`mt-1 text-[24px] font-bold ${isDark ? 'text-emerald-300' : 'text-emerald-600'}`}>
                        {formatPercent(analytics.total ? analytics.potableCount / analytics.total : 0)}
                      </Text>
                    </View>
                  </View>
                </View>
                <View className="flex-row gap-3">
                  <View className={`flex-1 rounded-2xl overflow-hidden border ${isDark ? 'border-slate-800/80 bg-slate-900/80' : 'border-slate-200 bg-slate-50'}`}>
                    <View className="h-1 bg-amber-400" />
                    <View className="p-3">
                      <Text className={`text-[10px] uppercase tracking-wide font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Watch + unsafe</Text>
                      <Text className={`mt-1 text-[24px] font-bold ${isDark ? 'text-amber-300' : 'text-amber-600'}`}>{analytics.watchOrUnsafe}</Text>
                    </View>
                  </View>
                  <View className={`flex-1 rounded-2xl overflow-hidden border ${isDark ? 'border-slate-800/80 bg-slate-900/80' : 'border-slate-200 bg-slate-50'}`}>
                    <View className="h-1 bg-sky-300" />
                    <View className="p-3">
                      <Text className={`text-[10px] uppercase tracking-wide font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Avg confidence</Text>
                      <Text className={`mt-1 text-[24px] font-bold ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                        {formatPercent(analytics.avgProbability || 0)}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            <View className={`rounded-2xl border overflow-hidden ${isDark ? 'border-sky-900/70 bg-sky-950/40' : 'border-sky-100 bg-sky-50'}`}>
              <View className={`px-4 py-3 border-b flex-row items-center justify-between ${isDark ? 'border-sky-900/50 bg-sky-950/60' : 'border-sky-100 bg-sky-100/60'}`}>
                <View>
                  <Text className={`text-[12px] font-bold uppercase tracking-widest ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                    Confidence trend
                  </Text>
                  <Text className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-sky-700/60'}`}>
                    Higher = more certain prediction
                  </Text>
                </View>
                <View className={`rounded-full px-2 py-0.5 ${isDark ? 'bg-sky-900/60' : 'bg-sky-200/80'}`}>
                  <Text className={`text-[10px] font-semibold ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
                    {analytics.recentCount} sample{analytics.recentCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
              <View className="px-4 pt-3 pb-1">
                <Text className={`text-[12px] leading-5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  How confident the model is in each prediction. Values above 0.7 indicate strong certainty.
                </Text>
                {analytics.recentCount > 1 && (
                  <Text className={`mt-1 text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    ← Swipe to see full history
                  </Text>
                )}
              </View>
              {hasChartData ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 8, paddingLeft: 4 }}
                  style={{ marginTop: 8, marginBottom: 12 }}
                >
                  <LineChart
                    data={analytics.confidenceTrend}
                    width={analytics.trendChartWidth}
                    height={CHART_HEIGHT}
                    chartConfig={chartConfig}
                    bezier
                    fromZero
                    style={{ borderRadius: 16 }}
                  />
                </ScrollView>
              ) : (
                <View className={`mx-4 mb-4 items-center rounded-xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900/50' : 'border-sky-200 bg-white'}`}>
                  <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Submit samples to see your confidence trend.</Text>
                </View>
              )}
            </View>

            <View className={`rounded-2xl border overflow-hidden ${isDark ? 'border-emerald-900/50 bg-slate-950/70' : 'border-emerald-100 bg-white'}`}>
              <View className={`px-4 py-3 border-b flex-row items-center justify-between ${isDark ? 'border-emerald-900/40 bg-emerald-950/30' : 'border-emerald-100 bg-emerald-50'}`}>
                <View>
                  <Text className={`text-[12px] font-bold uppercase tracking-widest ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                    Daily sample volume
                  </Text>
                  <Text className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-emerald-700/50'}`}>
                    How many samples per day
                  </Text>
                </View>
                <View className={`rounded-full px-2 py-0.5 ${isDark ? 'bg-emerald-900/60' : 'bg-emerald-200/70'}`}>
                  <Text className={`text-[10px] font-semibold ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>7 days</Text>
                </View>
              </View>
              <View className="px-4 pt-3 pb-1">
                <Text className={`text-[12px] leading-5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Consistent daily sampling leads to more reliable insights over time.
                </Text>
                <Text className={`mt-1 text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  ← Swipe to scroll
                </Text>
              </View>
              {hasChartData ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 8, paddingLeft: 4 }}
                  style={{ marginTop: 8, marginBottom: 12 }}
                >
                  <BarChart
                    data={analytics.volumeByDay}
                    width={analytics.volumeChartWidth}
                    height={CHART_HEIGHT}
                    fromZero
                    yAxisLabel=""
                    yAxisSuffix=""
                    showValuesOnTopOfBars
                    chartConfig={{
                      ...chartConfig,
                      color: (opacity = 1) => `rgba(52, 211, 153, ${opacity})`,
                    }}
                    style={{ borderRadius: 16 }}
                  />
                </ScrollView>
              ) : (
                <View className={`mx-4 mb-4 items-center rounded-xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900/50' : 'border-emerald-100 bg-emerald-50'}`}>
                  <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>No samples this week yet.</Text>
                </View>
              )}
            </View>

            <View className={`rounded-2xl border overflow-hidden ${isDark ? 'border-sky-900/70 bg-aquadark/80' : 'border-slate-200 bg-white'}`}>
              <View className={`px-4 py-3 border-b flex-row items-center justify-between ${isDark ? 'border-sky-900/50 bg-slate-900/60' : 'border-slate-100 bg-slate-50'}`}>
                <View>
                  <Text className={`text-[12px] font-bold uppercase tracking-widest ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                    Outcome mix
                  </Text>
                  <Text className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    Safety status of all samples
                  </Text>
                </View>
                {riskDistTotal > 0 && (
                  <View className={`rounded-full px-2 py-0.5 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                    <Text className={`text-[10px] font-semibold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{riskDistTotal} total</Text>
                  </View>
                )}
              </View>
              <View className="p-4">
                <Text className={`text-[12px] leading-5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Green = cleared, yellow = needs review, red = alert.
                </Text>
                {riskDistTotal > 0 ? (
                  <>
                    <PieChart
                      data={analytics.statusDistribution}
                      width={CHART_WIDTH}
                      height={210}
                      chartConfig={chartConfig}
                      accessor="population"
                      backgroundColor="transparent"
                      paddingLeft="10"
                      absolute
                    />
                    <View className={`mt-2 rounded-xl border p-3 flex-row justify-around ${isDark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-100 bg-slate-50'}`}>
                      {analytics.statusDistribution.map((item) => (
                        <View key={item.name} className="items-center gap-1">
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.color }} />
                          <Text className={`text-[12px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                            {Math.round((item.population / riskDistTotal) * 100)}%
                          </Text>
                          <Text className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{item.name}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : (
                  <View className={`mt-3 items-center rounded-xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}>
                    <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>No outcome data yet.</Text>
                  </View>
                )}
              </View>
            </View>

            <View className={`rounded-2xl border overflow-hidden ${isDark ? 'border-rose-900/50 bg-slate-950/70' : 'border-rose-100 bg-rose-50/40'}`}>
              <View className={`px-4 py-3 border-b flex-row items-center justify-between ${isDark ? 'border-rose-900/40 bg-rose-950/30' : 'border-rose-100 bg-rose-50'}`}>
                <View>
                  <Text className={`text-[12px] font-bold uppercase tracking-widest ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>
                    Risk trajectory
                  </Text>
                  <Text className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-rose-700/50'}`}>
                    Lower score = safer water
                  </Text>
                </View>
                <View className={`rounded-full px-2 py-0.5 ${isDark ? 'bg-rose-900/50' : 'bg-rose-100'}`}>
                  <Text className={`text-[10px] font-semibold ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>
                    {analytics.recentCount} sample{analytics.recentCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
              <View className="px-4 pt-3 pb-1">
                <Text className={`text-[12px] leading-5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Risk score mapped from safe (0.15) to unsafe (0.88). Aim to keep this trend flat or declining.
                </Text>
                {analytics.recentCount > 1 && (
                  <Text className={`mt-1 text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    ← Swipe to see full history
                  </Text>
                )}
              </View>
              {hasChartData ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 8, paddingLeft: 4 }}
                  style={{ marginTop: 8, marginBottom: 12 }}
                >
                  <LineChart
                    data={analytics.riskTrend}
                    width={analytics.trendChartWidth}
                    height={CHART_HEIGHT}
                    chartConfig={{
                      ...chartConfig,
                      color: (opacity = 1) => `rgba(251, 113, 133, ${opacity})`,
                      fillShadowGradient: '#fb7185',
                      fillShadowGradientOpacity: 0.12,
                    }}
                    fromZero
                    style={{ borderRadius: 16 }}
                  />
                </ScrollView>
              ) : (
                <View className={`mx-4 mb-4 items-center rounded-xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900/50' : 'border-rose-100 bg-white'}`}>
                  <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>No risk trend data yet.</Text>
                </View>
              )}
            </View>

            <View className={`rounded-2xl border overflow-hidden ${isDark ? 'border-sky-900/80 bg-sky-950/40' : 'border-sky-100 bg-sky-50'}`}>
              <View className={`px-4 py-3 border-b ${isDark ? 'border-sky-900/50 bg-sky-950/60' : 'border-sky-100 bg-sky-100/60'}`}>
                <Text className={`text-[12px] font-bold uppercase tracking-widest ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                  Water quality parameters
                </Text>
                <Text className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-sky-700/60'}`}>
                  Averages across all your samples
                </Text>
              </View>
              <View className="p-4 gap-3">
                {analytics.parameterCards.map((param) => {
                  const statusColor = {
                    ph: param.descriptor === 'Balanced' ? 'emerald' : 'amber',
                    turbidity: param.descriptor === 'Very clear' ? 'emerald' : param.descriptor === 'Acceptable' ? 'amber' : 'rose',
                    conductivity: param.descriptor === 'Low mineral load' ? 'emerald' : param.descriptor === 'Moderate mineral load' ? 'amber' : 'rose',
                    hardness: param.descriptor === 'Soft' || param.descriptor === 'Moderate' ? 'emerald' : param.descriptor === 'Hard' ? 'amber' : 'rose',
                  }[param.key] || 'slate';
                  const accentBar = statusColor === 'emerald' ? 'bg-emerald-400' : statusColor === 'amber' ? 'bg-amber-400' : statusColor === 'rose' ? 'bg-rose-400' : 'bg-slate-400';
                  return (
                    <View key={param.key} className={`rounded-xl border overflow-hidden ${isDark ? 'border-slate-800/70 bg-slate-900/75' : 'border-slate-200 bg-white'}`}>
                      <View className={`h-1 ${accentBar}`} />
                      <View className="p-3">
                        <View className="flex-row items-center justify-between">
                          <Text className={`text-[13px] font-bold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>{param.label}</Text>
                          <View className={`rounded-full px-2 py-0.5 ${
                            statusColor === 'emerald'
                              ? isDark ? 'bg-emerald-900/50' : 'bg-emerald-100'
                              : statusColor === 'amber'
                              ? isDark ? 'bg-amber-900/50' : 'bg-amber-100'
                              : statusColor === 'rose'
                              ? isDark ? 'bg-rose-900/50' : 'bg-rose-100'
                              : isDark ? 'bg-slate-800' : 'bg-slate-100'
                          }`}>
                            <Text className={`text-[10px] font-semibold ${
                              statusColor === 'emerald'
                                ? isDark ? 'text-emerald-300' : 'text-emerald-700'
                                : statusColor === 'amber'
                                ? isDark ? 'text-amber-300' : 'text-amber-700'
                                : statusColor === 'rose'
                                ? isDark ? 'text-rose-300' : 'text-rose-700'
                                : isDark ? 'text-slate-300' : 'text-slate-600'
                            }`}>{param.descriptor}</Text>
                          </View>
                        </View>
                        <View className={`mt-2 flex-row justify-between pt-2 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                          <View className="items-center">
                            <Text className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Average</Text>
                            <Text className={`mt-0.5 text-[15px] font-bold ${isDark ? 'text-sky-200' : 'text-sky-700'}`}>
                              {Number.isFinite(param.avg) ? param.avg.toFixed(2) : '--'}
                            </Text>
                          </View>
                          <View className={`w-px ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
                          <View className="items-center">
                            <Text className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Median</Text>
                            <Text className={`mt-0.5 text-[15px] font-semibold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                              {Number.isFinite(param.median) ? param.median.toFixed(2) : '--'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            <View className={`rounded-2xl border overflow-hidden ${isDark ? 'border-sky-900/70 bg-slate-950/75' : 'border-slate-200 bg-white'}`}>
              <View className={`px-4 py-3 border-b ${isDark ? 'border-sky-900/50 bg-slate-900/60' : 'border-slate-100 bg-slate-50'}`}>
                <Text className={`text-[12px] font-bold uppercase tracking-widest ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
                  Microbial risk
                </Text>
                <Text className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  Bacterial contamination level — high counts need immediate attention
                </Text>
              </View>
              <View className="p-4 flex-row gap-3">
                <View className={`flex-1 rounded-xl border overflow-hidden ${isDark ? 'border-emerald-900/50 bg-emerald-950/30' : 'border-emerald-200 bg-emerald-50'}`}>
                  <View className="h-1 bg-emerald-400" />
                  <View className="p-3 items-center">
                    <Text className={`text-[10px] uppercase font-bold tracking-wide ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>Low</Text>
                    <Text className={`mt-1 text-[26px] font-bold ${isDark ? 'text-emerald-300' : 'text-emerald-600'}`}>{analytics.microbialCounts.low}</Text>
                    <Text className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>samples</Text>
                  </View>
                </View>
                <View className={`flex-1 rounded-xl border overflow-hidden ${isDark ? 'border-amber-900/50 bg-amber-950/30' : 'border-amber-200 bg-amber-50'}`}>
                  <View className="h-1 bg-amber-400" />
                  <View className="p-3 items-center">
                    <Text className={`text-[10px] uppercase font-bold tracking-wide ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>Medium</Text>
                    <Text className={`mt-1 text-[26px] font-bold ${isDark ? 'text-amber-300' : 'text-amber-600'}`}>{analytics.microbialCounts.medium}</Text>
                    <Text className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>samples</Text>
                  </View>
                </View>
                <View className={`flex-1 rounded-xl border overflow-hidden ${isDark ? 'border-rose-900/50 bg-rose-950/30' : 'border-rose-200 bg-rose-50'}`}>
                  <View className="h-1 bg-rose-500" />
                  <View className="p-3 items-center">
                    <Text className={`text-[10px] uppercase font-bold tracking-wide ${isDark ? 'text-rose-400' : 'text-rose-700'}`}>High</Text>
                    <Text className={`mt-1 text-[26px] font-bold ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>{analytics.microbialCounts.high}</Text>
                    <Text className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>samples</Text>
                  </View>
                </View>
              </View>
            </View>

            <View className={`rounded-2xl border p-4 ${isDark ? 'border-emerald-500/40 bg-emerald-900/10' : 'border-emerald-200 bg-emerald-50'}`}>
              <View className="flex-row items-center gap-2">
                <Text className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                  Key takeaways
                </Text>
              </View>
              <Text className={`mt-0.5 text-[11px] ${isDark ? 'text-emerald-500/80' : 'text-emerald-600/70'}`}>
                Auto-generated from your sample history
              </Text>
              <View className="mt-3 gap-2.5">
                {analytics.insights.map((insight, index) => (
                  <View key={`${insight}-${index}`} className={`flex-row gap-2 rounded-xl border p-2.5 ${isDark ? 'border-emerald-900/50 bg-slate-900/60' : 'border-emerald-100 bg-white'}`}>
                    <Text className={`text-[13px] ${isDark ? 'text-emerald-400' : 'text-emerald-500'}`}>✦</Text>
                    <Text className={`flex-1 text-[12px] leading-5 ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{insight}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </Animated.View>
  );
};

export default AnalysisScreen;
