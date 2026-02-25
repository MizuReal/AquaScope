import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Animated, Modal, TextInput, Image } from 'react-native';
import LottieView from 'lottie-react-native';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../utils/supabaseClient';
import { chatWithGemini } from '../utils/api';
import homeWaterAnim from '../assets/public/HomeWater.json';
import cuteRobotAnim from '../assets/public/CuteRobot.json';
import { useAppTheme } from '../utils/theme';

const SUPABASE_PROFILES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_PROFILES_TABLE || 'profiles';
const SUPABASE_SAMPLES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_SAMPLES_TABLE || 'field_samples';
const SUPABASE_AVATAR_BUCKET = process.env.EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET || 'avatars';
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');

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

const FALLBACK_KEY_METRICS = [
	{
		id: 'potable_rate',
		label: 'Potable rate',
		value: '--',
		caption: 'No saved samples yet',
		badge: 'Waiting for history',
		badgeClass: 'text-emerald-300',
		borderClass: 'border-emerald-500/40',
	},
	{
		id: 'latest_sample',
		label: 'Latest sample',
		value: '--',
		caption: 'No timeline yet',
		badge: 'Upload first sample',
		badgeClass: 'text-sky-300',
		borderClass: 'border-sky-500/40',
	},
	{
		id: 'watchlist',
		label: 'Watchlist',
		value: '0',
		caption: 'Risk watch + unsafe',
		badge: 'No active alerts',
		badgeClass: 'text-amber-300',
		borderClass: 'border-amber-400/40',
	},
	{
		id: 'samples',
		label: 'Saved samples',
		value: '0',
		caption: 'In your history',
		badge: 'Start with Data Input',
		badgeClass: 'text-rose-300',
		borderClass: 'border-rose-400/40',
	},
];

const FALLBACK_CHEMISTRY_CARDS = [
	{
		id: 'ph',
		label: 'pH',
		value: '--',
		descriptor: 'No samples yet',
		change: 'Add readings to trend',
		barWidth: 'w-[72%]',
		barColor: 'bg-emerald-400',
	},
	{
		id: 'turbidity',
		label: 'Turbidity (NTU)',
		value: '--',
		descriptor: 'No samples yet',
		change: 'Add readings to trend',
		barWidth: 'w-[30%]',
		barColor: 'bg-sky-400',
	},
	{
		id: 'conductivity',
		label: 'Conductivity',
		value: '--',
		descriptor: 'No samples yet',
		change: 'Add readings to trend',
		barWidth: 'w-[55%]',
		barColor: 'bg-amber-300',
	},
	{
		id: 'hardness',
		label: 'Hardness',
		value: '--',
		descriptor: 'No samples yet',
		change: 'Add readings to trend',
		barWidth: 'w-[65%]',
		barColor: 'bg-purple-300',
	},
];

const average = (values = []) => {
	if (!values.length) return null;
	const sum = values.reduce((acc, value) => acc + value, 0);
	return sum / values.length;
};

const formatCompactElapsed = (timestamp) => {
	if (!timestamp) return '--';
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return '--';
	const diffMs = Date.now() - date.getTime();
	const minutes = Math.max(0, Math.floor(diffMs / 60000));
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return `${days}d`;
};

const formatMetricValue = (value, digits = 2) => {
	if (!Number.isFinite(value)) return '--';
	return Number(value).toFixed(digits);
};

const formatDeltaLabel = (latest, avgValue, suffix = '') => {
	if (!Number.isFinite(latest) || !Number.isFinite(avgValue)) {
		return 'Insufficient trend data';
	}
	const delta = latest - avgValue;
	const sign = delta >= 0 ? '+' : '-';
	return `${sign}${Math.abs(delta).toFixed(2)} vs recent avg${suffix}`;
};


const CHAT_TABS = [
	{ id: 'quality', label: 'Ask about water quality' },
	{ id: 'data', label: 'Ask about my data' },
];

const DATA_SCOPE_HINT =
	'I can help with your saved water data: sample history, trends, risk levels, confidence, and parameter patterns.';
const QUALITY_SCOPE_HINT =
	'I can help with water-quality topics like pH, turbidity, hardness, conductivity, contamination risk, and interpretation.';

const CHEMISTRY_ICONS = {
	ph: 'flask-outline',
	turbidity: 'waves-arrow-up',
	conductivity: 'flash-outline',
	hardness: 'beaker-outline',
};

const containsKeyword = (text = '', keywords = []) => {
	const lower = text.toLowerCase();
	return keywords.some((keyword) => lower.includes(keyword));
};

const isAllowedDataPrompt = (text = '') => Boolean(text && text.trim().length > 0);

const isAllowedQualityPrompt = (text = '') => {
	const qualityKeywords = [
		'water',
		'quality',
		'potable',
		'non-potable',
		'ph',
		'turbidity',
		'conductivity',
		'hardness',
		'chlorine',
		'contamination',
		'bacteria',
		'microbial',
		'safe',
		'unsafe',
		'parameter',
		'pollution',
		'who',
	];
	return containsKeyword(text, qualityKeywords);
};

const HomeScreen = ({ onNavigate, openChatSignal }) => {
	const { isDark } = useAppTheme();
	const insets = useSafeAreaInsets();
	const tabBarClearance = Math.max(148, insets.bottom + 128);
  const heroAnim = useRef(new Animated.Value(0)).current;
  const cardsAnim = useRef(new Animated.Value(0)).current;
	const [chatOpen, setChatOpen] = useState(false);
	const [activeChatTab, setActiveChatTab] = useState('quality');
	const [chatInput, setChatInput] = useState('');
	const [profileName, setProfileName] = useState('');
	const [avatarUrl, setAvatarUrl] = useState('');
	const [sessionUserId, setSessionUserId] = useState('');
	const [savedSamples, setSavedSamples] = useState([]);
	const [chatLoading, setChatLoading] = useState(false);
	const [keyMetrics, setKeyMetrics] = useState(FALLBACK_KEY_METRICS);
	const [chemistryCards, setChemistryCards] = useState(FALLBACK_CHEMISTRY_CARDS);
	const [clusterRiskLabel, setClusterRiskLabel] = useState('No data');
	const [clusterIndexLabel, setClusterIndexLabel] = useState('Composite index pending');
	const [clusterBarPercent, setClusterBarPercent] = useState(8);
	const [chatThreads, setChatThreads] = useState({
		quality: [
			{
				id: 'quality-1',
				role: 'assistant',
				text: QUALITY_SCOPE_HINT,
			},
		],
		data: [
			{
				id: 'data-1',
				role: 'assistant',
				text: DATA_SCOPE_HINT,
			},
		],
	});

	const metricLookup = useMemo(() => {
		return keyMetrics.reduce((acc, metric) => {
			acc[metric.id] = metric;
			return acc;
		}, {});
	}, [keyMetrics]);

	const appendAssistantMessage = (threadKey, text) => {
		const timestamp = Date.now();
		setChatThreads((prev) => {
			const thread = prev[threadKey] || [];
			return {
				...prev,
				[threadKey]: [
					...thread,
					{ id: `${threadKey}-assistant-${timestamp}`, role: 'assistant', text },
				],
			};
		});
	};

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
				console.warn('[Supabase] home profile refresh failed:', profileResult.error.message || profileResult.error);
				return;
			}

			setProfileName(profileResult.data?.display_name || user.email || '');
			setAvatarUrl(withAvatarVersion(normalizeAvatarUrl(profileResult.data?.avatar_url)));
		} catch (error) {
			console.warn('[Supabase] home profile refresh error:', error?.message || error);
		}
	}, []);

	const handleSendChat = async () => {
		const trimmed = chatInput.trim();
		if (!trimmed || chatLoading) {
			return;
		}
		const threadKey = activeChatTab === 'quality' ? 'quality' : 'data';
		const timestamp = Date.now();
		const userEntry = { id: `${threadKey}-user-${timestamp}`, role: 'user', text: trimmed };

		setChatThreads((prev) => {
			const thread = prev[threadKey] || [];
			return {
				...prev,
				[threadKey]: [...thread, userEntry],
			};
		});

		setChatInput('');

		const allowed =
			threadKey === 'quality' ? isAllowedQualityPrompt(trimmed) : isAllowedDataPrompt(trimmed);

		if (!allowed) {
			const message =
				threadKey === 'quality'
					? 'I can help with water-related questions only in this tab. Please ask about water quality, safety, or water parameters.'
					: 'I can help with your saved data in this tab. Ask any question about your recent records, trends, or results.';
			appendAssistantMessage(threadKey, message);
			return;
		}

		const scopePrefix = threadKey === 'quality' ? 'Water quality' : "Users' data";
		const scopedPrompt = `${scopePrefix} + ${trimmed}`;
		const threadSnapshot = [
			...(chatThreads[threadKey] || []).map((message) => ({
				role: message.role,
				text:
					message.role === 'user'
						? `${scopePrefix} + ${message.text}`
						: message.text,
			})),
			{ role: 'user', text: scopedPrompt },
		];

		setChatLoading(true);

		try {
			const qualityContext = {
				tab: 'quality',
				scope: 'water_quality_only',
				rule: 'Reject anything unrelated to water quality.',
				clusterRisk: clusterRiskLabel,
				clusterIndex: clusterIndexLabel,
				keyMetrics,
				chemistryCards,
			};

			const userDataContext = {
				tab: 'users_data',
				scope: 'user_saved_samples_only',
				rule: 'Reject requests outside saved user water-sample context.',
				sampleCount: savedSamples.length,
				samples: savedSamples.slice(0, 20).map((row) => ({
					id: row?.id,
					created_at: row?.created_at,
					source: row?.source,
					prediction_is_potable: row?.prediction_is_potable,
					prediction_probability: row?.prediction_probability,
					risk_level: row?.risk_level,
					ph: row?.ph,
					turbidity: row?.turbidity,
					conductivity: row?.conductivity,
					hardness: row?.hardness,
				})),
			};

			const analysisPayload = threadKey === 'quality' ? qualityContext : userDataContext;
			const response = await chatWithGemini(analysisPayload, threadSnapshot, scopedPrompt);
			appendAssistantMessage(
				threadKey,
				response?.reply || 'No response generated. Please try rephrasing within the allowed scope.'
			);
		} catch (error) {
			appendAssistantMessage(
				threadKey,
				`Error: ${error?.message || 'Chat request failed'}`
			);
		} finally {
			setChatLoading(false);
		}
	};

	useFocusEffect(
		useCallback(() => {
			heroAnim.setValue(0);
			cardsAnim.setValue(0);

			const animation = Animated.parallel([
				Animated.timing(heroAnim, {
					toValue: 1,
					duration: 320,
					delay: 0,
					useNativeDriver: true,
				}),
				Animated.timing(cardsAnim, {
					toValue: 1,
					duration: 320,
					delay: 60,
					useNativeDriver: true,
				}),
			]);

			animation.start();

			return () => {
				animation.stop();
			};
		}, [cardsAnim, heroAnim])
	);

	useEffect(() => {
		let isMounted = true;

		const loadOverview = async () => {
			try {
				const sessionResult = await supabase.auth.getSession();
				const user = sessionResult?.data?.session?.user || null;
				if (!user) {
					if (isMounted) {
						setSessionUserId('');
						setProfileName('');
						setAvatarUrl('');
						setKeyMetrics(FALLBACK_KEY_METRICS);
						setChemistryCards(FALLBACK_CHEMISTRY_CARDS);
						setClusterRiskLabel('No data');
						setClusterIndexLabel('Composite index pending');
						setClusterBarPercent(8);
					}
					return;
				}

				if (isMounted) {
					setSessionUserId(user.id);
				}

				const [profileResult, samplesResult] = await Promise.all([
					supabase
						.from(SUPABASE_PROFILES_TABLE)
						.select('display_name, avatar_url')
						.eq('id', user.id)
						.single(),
					supabase
						.from(SUPABASE_SAMPLES_TABLE)
						.select('id, created_at, source, ph, turbidity, conductivity, hardness, prediction_is_potable, prediction_probability, risk_level')
						.eq('user_id', user.id)
						.order('created_at', { ascending: false })
						.limit(40),
				]);

				if (profileResult.error && profileResult.error.code !== 'PGRST116') {
					console.warn('[Supabase] profile fetch failed:', profileResult.error.message || profileResult.error);
				}

				if (samplesResult.error) {
					console.warn('[Supabase] overview sample fetch failed:', samplesResult.error.message || samplesResult.error);
				}

				const samples = samplesResult.data || [];
				setSavedSamples(samples);
				const totalSamples = samples.length;
				const now = Date.now();
				const dayAgo = now - 24 * 60 * 60 * 1000;
				const recent24h = samples.filter((row) => {
					const ts = row?.created_at ? new Date(row.created_at).getTime() : 0;
					return ts >= dayAgo;
				}).length;
				const potableCount = samples.filter((row) => row?.prediction_is_potable === true).length;
				const watchCount = samples.filter((row) => {
					const risk = (row?.risk_level || '').toLowerCase();
					return risk === 'watch' || risk === 'unsafe';
				}).length;
				const confidenceValues = samples
					.map((row) => row?.prediction_probability)
					.filter((value) => Number.isFinite(value));
				const avgConfidence = average(confidenceValues);
				const latestSample = samples[0] || null;
				const phValues = samples.map((row) => row?.ph).filter((value) => Number.isFinite(value));
				const turbidityValues = samples.map((row) => row?.turbidity).filter((value) => Number.isFinite(value));
				const conductivityValues = samples.map((row) => row?.conductivity).filter((value) => Number.isFinite(value));
				const hardnessValues = samples.map((row) => row?.hardness).filter((value) => Number.isFinite(value));
				const phAvg = average(phValues);
				const turbidityAvg = average(turbidityValues);
				const conductivityAvg = average(conductivityValues);
				const hardnessAvg = average(hardnessValues);

				const dynamicKeyMetrics = [
					{
						id: 'potable_rate',
						label: 'Potable rate',
						value: totalSamples ? `${Math.round((potableCount / totalSamples) * 100)}%` : '--',
						caption: totalSamples ? `${potableCount}/${totalSamples} marked potable` : 'No saved samples yet',
						badge: totalSamples ? `${recent24h} in last 24h` : 'Waiting for history',
						badgeClass: 'text-emerald-300',
						borderClass: 'border-emerald-500/40',
					},
					{
						id: 'latest_sample',
						label: 'Latest sample',
						value: latestSample?.created_at ? formatCompactElapsed(latestSample.created_at) : '--',
						caption: latestSample?.source || 'No timeline yet',
						badge:
							Number.isFinite(avgConfidence) && avgConfidence >= 0
								? `Avg confidence ${(avgConfidence * 100).toFixed(0)}%`
								: 'Confidence pending',
						badgeClass: 'text-sky-300',
						borderClass: 'border-sky-500/40',
					},
					{
						id: 'watchlist',
						label: 'Watchlist',
						value: `${watchCount}`,
						caption: 'Risk watch + unsafe',
						badge: watchCount ? 'Review flagged samples' : 'No active alerts',
						badgeClass: 'text-amber-300',
						borderClass: 'border-amber-400/40',
					},
					{
						id: 'samples',
						label: 'Saved samples',
						value: `${totalSamples}`,
						caption: 'In your history',
						badge: totalSamples ? 'Synced from Data Input' : 'Start with Data Input',
						badgeClass: 'text-rose-300',
						borderClass: 'border-rose-400/40',
					},
				];

				const dynamicChemistryCards = [
					{
						id: 'ph',
						label: 'pH',
						value: formatMetricValue(phAvg),
						descriptor: 'Recent average',
						change: formatDeltaLabel(latestSample?.ph, phAvg),
						barWidth: 'w-[72%]',
						barColor: 'bg-emerald-400',
					},
					{
						id: 'turbidity',
						label: 'Turbidity (NTU)',
						value: formatMetricValue(turbidityAvg),
						descriptor: 'Recent average',
						change: formatDeltaLabel(latestSample?.turbidity, turbidityAvg),
						barWidth: 'w-[30%]',
						barColor: 'bg-sky-400',
					},
					{
						id: 'conductivity',
						label: 'Conductivity',
						value: Number.isFinite(conductivityAvg) ? `${Number(conductivityAvg).toFixed(0)} uS/cm` : '--',
						descriptor: 'Recent average',
						change: formatDeltaLabel(latestSample?.conductivity, conductivityAvg),
						barWidth: 'w-[55%]',
						barColor: 'bg-amber-300',
					},
					{
						id: 'hardness',
						label: 'Hardness',
						value: formatMetricValue(hardnessAvg),
						descriptor: 'Recent average',
						change: formatDeltaLabel(latestSample?.hardness, hardnessAvg),
						barWidth: 'w-[65%]',
						barColor: 'bg-purple-300',
					},
				];

				const safeRatio = totalSamples ? potableCount / totalSamples : 0;
				const riskLabel =
					totalSamples === 0
						? 'No data'
						: safeRatio >= 0.8
							? 'Low risk'
							: safeRatio >= 0.5
								? 'Moderate risk'
								: 'High risk';
				const riskIndex = totalSamples ? 1 - safeRatio : 0;
				const boundedRiskIndex = Math.max(0, Math.min(1, riskIndex));
				const progressPercent = Math.round((1 - boundedRiskIndex) * 100);

				if (isMounted) {
					setProfileName(profileResult.data?.display_name || user.email || '');
					setAvatarUrl(withAvatarVersion(normalizeAvatarUrl(profileResult.data?.avatar_url)));
					setKeyMetrics(dynamicKeyMetrics);
					setChemistryCards(dynamicChemistryCards);
					setClusterRiskLabel(riskLabel);
					setClusterIndexLabel(
						totalSamples
							? `Composite index ${boundedRiskIndex.toFixed(2)} from ${totalSamples} samples`
							: 'Composite index pending'
					);
					setClusterBarPercent(Math.max(8, progressPercent));
				}
			} catch (error) {
				console.warn('[Supabase] overview fetch error:', error?.message || error);
				if (isMounted) {
					setSavedSamples([]);
				}
			}
		};

		loadOverview();

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
			.channel(`home-profile-sync-${sessionUserId}`)
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

	const currentThread = chatThreads[activeChatTab === 'quality' ? 'quality' : 'data'] || [];

	useEffect(() => {
		if (openChatSignal) {
			setChatOpen(true);
		}
	}, [openChatSignal]);

	return (
		<View className={`flex-1 ${isDark ? 'bg-aquadark' : 'bg-slate-100'}`}>
			<ScrollView
				className="px-5 pt-10"
				contentContainerClassName="gap-6"
				contentContainerStyle={{ paddingBottom: tabBarClearance }}
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
					<View className="mb-5 flex-row items-center justify-between">
						<View className="flex-row items-center gap-3">
							<View className={`h-12 w-12 overflow-hidden rounded-2xl border ${isDark ? 'border-sky-800/70 bg-slate-950/70' : 'border-slate-300 bg-slate-200'}`}>
								{avatarUrl ? (
									<Image source={{ uri: avatarUrl }} className="h-full w-full" resizeMode="cover" />
								) : (
									<View className="h-full w-full items-center justify-center">
										<Text className={`text-[16px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-800'}`}>
											{getInitials(profileName)}
										</Text>
									</View>
								)}
							</View>
							<View>
								<Text className="text-[12px] uppercase tracking-[2px] text-sky-400">
									Welcome back
								</Text>
								<Text className={`text-[16px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-800'}`} numberOfLines={1}>
									{profileName || 'Field operator'}
								</Text>
							</View>
						</View>
						<View
							className={`rounded-full border px-3 py-1 ${
								isDark ? 'border-amber-400/60 bg-amber-400/10' : 'border-amber-300 bg-amber-100'
							}`}
						>
							<View className="flex-row items-center gap-1.5">
								<MaterialCommunityIcons
									name="shield-check"
									size={12}
									color={isDark ? '#fcd34d' : '#92400e'}
								/>
								<Text className={`text-[11px] font-semibold ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>Status</Text>
							</View>
						</View>
					</View>

					<View className="flex-row items-center justify-between">
						<View className={`h-36 w-[48%] items-center justify-center overflow-hidden rounded-[26px] border ${isDark ? 'border-sky-900/70 bg-slate-950/60' : 'border-slate-300 bg-slate-100'}`}>
							<LottieView source={homeWaterAnim} autoPlay loop style={{ width: 150, height: 150 }} />
						</View>
						<View className={`h-36 w-[48%] items-center justify-center overflow-hidden rounded-[26px] border ${isDark ? 'border-sky-900/70 bg-slate-950/60' : 'border-slate-300 bg-slate-100'}`}>
							<LottieView source={cuteRobotAnim} autoPlay loop style={{ width: 150, height: 150 }} />
						</View>
					</View>

					<Text className={`mt-5 text-[20px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
						Know water safety fast.
					</Text>
					<Text className={`mt-2 text-[13px] ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
						Capture a sample, get instant potability insight, and track trends without noise.
					</Text>

					<View className="mt-5 flex-row items-center gap-3">
						<TouchableOpacity
							activeOpacity={0.85}
							className="flex-1 items-center rounded-2xl border border-aquaaccent/60 bg-aquaaccent/80 px-4 py-3"
							onPress={() => onNavigate?.('dataInput')}
						>
							<View className="flex-row items-center gap-2">
								<Feather name="camera" size={14} color="#0f172a" />
								<Text className="text-[13px] font-semibold text-slate-950">Capture sample</Text>
							</View>
						</TouchableOpacity>
						<TouchableOpacity
							activeOpacity={0.85}
							className={`flex-1 items-center rounded-2xl border px-4 py-3 ${isDark ? 'border-sky-900/70 bg-slate-950/70' : 'border-slate-300 bg-slate-100'}`}
							onPress={() => onNavigate?.('predictionHistory')}
						>
							<View className="flex-row items-center gap-2">
								<Feather name="clock" size={14} color={isDark ? '#e0f2fe' : '#1f2937'} />
								<Text className={`text-[13px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>View history</Text>
							</View>
						</TouchableOpacity>
					</View>

					<TouchableOpacity
						activeOpacity={0.88}
						className="mt-3 items-center rounded-2xl border border-cyan-400/60 bg-cyan-400/20 px-4 py-3"
						onPress={() => setChatOpen(true)}
					>
						<View className="flex-row items-center gap-2">
							<MaterialCommunityIcons name="robot-happy-outline" size={16} color={isDark ? '#22d3ee' : '#0891b2'} />
							<Text className={`text-[13px] font-semibold ${isDark ? 'text-cyan-200' : 'text-cyan-800'}`}>Ask Copilot</Text>
						</View>
					</TouchableOpacity>

					<View className="mt-5 flex-row items-center gap-3">
						<View className={`flex-1 rounded-2xl border border-emerald-500/40 px-4 py-3 ${isDark ? 'bg-slate-950/60' : 'bg-emerald-50'}`}>
							<View className="flex-row items-center gap-1.5">
								<MaterialCommunityIcons name="alert-circle-outline" size={12} color={isDark ? '#86efac' : '#047857'} />
								<Text className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-emerald-300' : 'text-emerald-600'}`}>Risk</Text>
							</View>
							<Text className={`mt-2 text-[18px] font-semibold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}>{clusterRiskLabel}</Text>
							<Text className={`mt-1 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`} numberOfLines={1}>
								{clusterIndexLabel}
							</Text>
						</View>
						<View className={`flex-1 rounded-2xl border border-sky-500/40 px-4 py-3 ${isDark ? 'bg-slate-950/60' : 'bg-sky-50'}`}>
							<View className="flex-row items-center gap-1.5">
								<MaterialCommunityIcons name="database-outline" size={12} color={isDark ? '#7dd3fc' : '#0369a1'} />
								<Text className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>Samples</Text>
							</View>
							<Text className={`mt-2 text-[18px] font-semibold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}>
								{metricLookup?.samples?.value || '--'}
							</Text>
							<Text className={`mt-1 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`} numberOfLines={1}>
								{metricLookup?.latest_sample?.caption || 'No timeline yet'}
							</Text>
						</View>
					</View>

					<View className={`mt-4 rounded-2xl border border-amber-400/40 px-4 py-3 ${isDark ? 'bg-slate-950/60' : 'bg-amber-50'}`}>
						<View className="flex-row items-center gap-1.5">
							<MaterialCommunityIcons name="bell-alert-outline" size={12} color={isDark ? '#fcd34d' : '#b45309'} />
							<Text className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-amber-300' : 'text-amber-600'}`}>Watchlist</Text>
						</View>
						<Text className={`mt-2 text-[18px] font-semibold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}>
							{metricLookup?.watchlist?.value || '0'}
						</Text>
						<Text className={`mt-1 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`} numberOfLines={1}>
							{metricLookup?.watchlist?.badge || 'No active alerts'}
						</Text>
					</View>

					<Text className={`mt-5 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
						Minimal, focused, and ready for the next sample.
					</Text>
				</Animated.View>

				<Animated.View
					style={{
						opacity: cardsAnim,
						transform: [
							{
								translateY: cardsAnim.interpolate({
									inputRange: [0, 1],
									outputRange: [18, 0],
								}),
							},
						],
						borderRadius: 30,
						padding: 20,
						borderWidth: 1,
						borderColor: isDark ? 'rgba(12,74,110,0.7)' : '#cbd5e1',
						backgroundColor: isDark ? 'rgba(2,6,23,0.7)' : '#ffffff',
					}}
				>
					<Text className={`text-[12px] uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>Chemistry pulse</Text>
					<View className="mt-3 flex-row gap-3">
						{chemistryCards.slice(0, 2).map((card) => (
							<View
								key={card.id}
								className={`flex-1 min-w-0 rounded-2xl border px-4 py-3 ${isDark ? 'border-sky-900/70 bg-slate-950/80' : 'border-slate-300 bg-slate-50'}`}
							>
								<View className="flex-row items-center gap-1.5">
									<MaterialCommunityIcons
										name={CHEMISTRY_ICONS[card.id] || 'chart-line'}
										size={12}
										color={isDark ? '#7dd3fc' : '#0284c7'}
									/>
									<Text className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
										{card.label}
									</Text>
								</View>
								<Text className={`mt-2 text-[18px] font-semibold ${isDark ? 'text-slate-50' : 'text-slate-900'}`} numberOfLines={1}>
									{card.value}
								</Text>
								<Text className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`} numberOfLines={1}>
									{card.change}
								</Text>
							</View>
						))}
					</View>
					<Text className={`mt-3 text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
						Open Analytics to explore full chemistry trends.
					</Text>
				</Animated.View>

			</ScrollView>

			<Modal
				visible={chatOpen}
				animationType="fade"
				transparent
				onRequestClose={() => setChatOpen(false)}
			>
				<View className={`flex-1 px-5 py-10 ${isDark ? 'bg-black/70' : 'bg-slate-900/35'}`}>
					<View className="flex-1 justify-center">
						<View
							className={`max-h-[80%] rounded-[32px] p-5 ${
								isDark ? 'border border-sky-900/80 bg-slate-950/95' : 'border border-slate-300 bg-white'
							}`}
						>
							<View className="flex-row items-center justify-between">
								<View>
									<Text className={`text-[16px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
										AquaScope Copilot
									</Text>
									<Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
										Conversational assistant
									</Text>
								</View>
								<TouchableOpacity
									activeOpacity={0.8}
									onPress={() => setChatOpen(false)}
									className={`h-10 w-10 items-center justify-center rounded-full border ${isDark ? 'border-slate-800/70' : 'border-slate-300'}`}
								>
									<Text className={`text-[16px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-700'}`}>X</Text>
								</TouchableOpacity>
							</View>

							<View className={`mt-4 flex-row rounded-full border p-1 ${isDark ? 'border-slate-800/80 bg-slate-900/60' : 'border-slate-300 bg-slate-100'}`}>
								{CHAT_TABS.map((tab) => {
									const selected = activeChatTab === tab.id;
									return (
										<TouchableOpacity
											key={tab.id}
											activeOpacity={0.85}
											className={`flex-1 rounded-full px-3 py-1.5 ${
												selected ? 'bg-aquaaccent/20' : 'bg-transparent'
											}`}
											onPress={() => setActiveChatTab(tab.id)}
										>
											<View className="flex-row items-center justify-center gap-1.5">
												<MaterialCommunityIcons
													name={tab.id === 'quality' ? 'water-check-outline' : 'database-search-outline'}
													size={12}
													color={selected ? '#22d3ee' : isDark ? '#cbd5e1' : '#475569'}
												/>
												<Text
													className={`text-center text-[12px] font-semibold ${
													selected ? 'text-aquaaccent' : isDark ? 'text-slate-300' : 'text-slate-600'
													}`}
													numberOfLines={1}
												>
													{tab.label}
												</Text>
											</View>
										</TouchableOpacity>
									);
								})}
							</View>

							<ScrollView
								className="mt-5"
								contentContainerClassName="gap-3 pb-4"
								showsVerticalScrollIndicator={false}
								style={{ maxHeight: 320 }}
							>
								{currentThread.map((message) => {
									const isUser = message.role === 'user';
									return (
										<View
											key={message.id}
											className={`max-w-[85%] rounded-2xl px-4 py-3 ${
												isUser
													? isDark
														? 'self-end bg-aquaaccent/20 border border-aquaaccent/40'
														: 'self-end bg-aquaaccent/30 border border-aquaaccent/60'
												: isDark ? 'self-start border border-slate-800/80 bg-slate-900/80' : 'self-start border border-slate-300 bg-slate-100'
											}`}
										>
											<Text className={`text-[13px] ${isDark ? 'text-sky-50' : 'text-slate-800'}`}>{message.text}</Text>
										</View>
									);
								})}
								{chatLoading && (
									<View className={`max-w-[85%] self-start rounded-2xl border px-4 py-3 ${isDark ? 'border-slate-800/80 bg-slate-900/80' : 'border-slate-300 bg-slate-100'}`}>
										<Text className={`text-[13px] ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>Thinking...</Text>
									</View>
								)}
							</ScrollView>

							<View className="mt-4 flex-row items-center gap-3">
								<TextInput
									className={`flex-1 rounded-2xl border px-4 py-3 ${isDark ? 'border-slate-800/70 bg-slate-900/80 text-sky-100' : 'border-slate-300 bg-slate-50 text-slate-800'}`}
									placeholder="Write a prompt..."
									placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
									value={chatInput}
									onChangeText={setChatInput}
									multiline
									style={{ maxHeight: 100 }}
								/>
								<TouchableOpacity
									activeOpacity={0.85}
									className={`rounded-2xl border border-aquaaccent/60 px-4 py-3 ${chatLoading ? (isDark ? 'bg-slate-700' : 'bg-slate-200') : 'bg-aquaaccent/80'}`}
									onPress={handleSendChat}
									disabled={chatLoading}
								>
									<Text className={`text-[13px] font-semibold ${chatLoading ? (isDark ? 'text-slate-300' : 'text-slate-500') : 'text-slate-950'}`}>
										{chatLoading ? 'Sending' : 'Send'}
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

export default HomeScreen;
