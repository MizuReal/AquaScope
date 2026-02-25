import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, SafeAreaView, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import LottieView from 'lottie-react-native';
import { getFiltrationSuggestion, chatWithGemini } from '../utils/api';
import { useAppTheme } from '../utils/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GAUGE_WIDTH = Math.min(SCREEN_WIDTH - 80, 280);

/** Error boundary so a crash inside MicrobialRiskSection never hides the whole result screen. */
class MicrobialErrorBoundary extends React.Component {
	state = { hasError: false };
	static getDerivedStateFromError() {
		return { hasError: true };
	}
	componentDidCatch(error, info) {
		console.warn('[MicrobialRiskSection] render error:', error, info);
	}
	render() {
		const isDark = this.props.isDark !== false;
		if (this.state.hasError) {
			return (
				<View
					className={`mt-6 rounded-[28px] border p-5 ${
						isDark ? 'border-rose-500/30 bg-rose-500/5' : 'border-rose-300 bg-rose-100'
					}`}
				>
					<Text className={`text-[12px] font-semibold ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>
						Microbial risk data is available but could not be rendered.
					</Text>
					<Text className={`text-[10px] mt-1 ${isDark ? 'text-rose-400/60' : 'text-rose-600'}`}>
						Check the console for details.
					</Text>
				</View>
			);
		}
		return this.props.children;
	}
}

const CONFIDENCE_ANIMATIONS = {
	low: require('../assets/public/not.json'),
	medium: require('../assets/public/warning.json'),
	high: require('../assets/public/yes.json'),
};

const getConfidenceAnimation = (probability = 0) => {
	const p = Number.isFinite(probability) ? probability : 0;
	if (p < 0.5) return CONFIDENCE_ANIMATIONS.low; // < 50%
	if (p < 0.7) return CONFIDENCE_ANIMATIONS.medium; // 50–70%
	return CONFIDENCE_ANIMATIONS.high; // > 70%
};

const ConfidenceGauge = ({ probability, threshold = 0.5, isDark = true }) => {
	const percentage = Math.round(probability * 100);
	const thresholdPos = threshold * 100;
	const isAboveThreshold = probability >= threshold;
	
	const getConfidenceLevel = (prob) => {
		if (prob >= 0.85) return { label: 'High', color: 'bg-emerald-500', textColor: 'text-emerald-400' };
		if (prob >= 0.65) return { label: 'Moderate', color: 'bg-sky-500', textColor: 'text-sky-400' };
		if (prob >= 0.5) return { label: 'Low', color: 'bg-amber-500', textColor: 'text-amber-400' };
		return { label: 'Very Low', color: 'bg-rose-500', textColor: 'text-rose-400' };
	};
	
	const confidence = getConfidenceLevel(probability);
	
	const segments = [
		{ range: [0, 50], color: 'bg-rose-500/30', activeColor: 'bg-rose-500' },
		{ range: [50, 65], color: 'bg-amber-500/30', activeColor: 'bg-amber-500' },
		{ range: [65, 85], color: 'bg-sky-500/30', activeColor: 'bg-sky-500' },
		{ range: [85, 100], color: 'bg-emerald-500/30', activeColor: 'bg-emerald-500' },
	];

	return (
		<View className="mt-4">
			<View className="flex-row items-center justify-between mb-2">
				<Text className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
					Model Confidence
				</Text>
				<View className="flex-row items-center gap-1.5">
					<View className={`w-2 h-2 rounded-full ${confidence.color}`} />
					<Text className={`text-[11px] font-semibold ${confidence.textColor}`}>
						{confidence.label}
					</Text>
				</View>
			</View>
			
			{/* Gauge Bar */}
			<View className={`h-3 rounded-full overflow-hidden flex-row ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
				{segments.map((seg, i) => {
					const segWidth = seg.range[1] - seg.range[0];
					const fillWidth = Math.max(0, Math.min(percentage - seg.range[0], segWidth));
					const fillPercent = (fillWidth / segWidth) * 100;
					return (
						<View 
							key={i} 
							className={`h-full ${seg.color}`} 
							style={{ width: `${segWidth}%` }}
						>
							{fillPercent > 0 && (
								<View 
									className={`h-full ${seg.activeColor}`} 
									style={{ width: `${fillPercent}%` }} 
								/>
							)}
						</View>
					);
				})}
			</View>
			
			{/* Scale Labels */}
			<View className="flex-row justify-between mt-1.5">
				<Text className={`text-[9px] ${isDark ? 'text-slate-600' : 'text-slate-500'}`}>0%</Text>
				<Text className={`text-[9px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>50%</Text>
				<Text className={`text-[9px] ${isDark ? 'text-slate-600' : 'text-slate-500'}`}>100%</Text>
			</View>
			
			{/* Confidence Value */}
			<View className="items-center mt-3">
				<Text className={`text-[32px] font-bold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}>{percentage}%</Text>
				<Text className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
					{isAboveThreshold ? 'Above' : 'Below'} decision threshold ({Math.round(thresholdPos)}%)
				</Text>
			</View>

			{/* ─── Prediction Analytics ─── */}
			<PredictionAnalytics probability={probability} threshold={threshold} isDark={isDark} />
			
		</View>
	);
};

/** Compact metric row with bar, value, and description */
const AnalyticsMetric = ({ label, value, description, barColor, isDark = true }) => {
	const pct = Math.round(value * 100);
	const resolvedColor = barColor || (
		pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-rose-500'
	);
	return (
		<View className="gap-1">
			<View className="flex-row items-center justify-between">
				<Text className={`text-[10px] font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{label}</Text>
				<Text className={`text-[11px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{pct}%</Text>
			</View>
			<View className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
				<View
					className={`h-full rounded-full ${resolvedColor}`}
					style={{ width: `${pct}%` }}
				/>
			</View>
			<Text className={`text-[9px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>{description}</Text>
		</View>
	);
};

/** Full analytics breakdown panel */
const PredictionAnalytics = ({ probability, threshold, isDark = true }) => {
	const p = probability;
	const t = threshold;

	// Certainty — how far from the 50/50 uncertainty point (0 = coin flip, 1 = fully certain)
	const certainty = Math.abs(p - 0.5) * 2;
	// Threshold margin — normalized distance from decision boundary
	const margin = Math.min(Math.abs(p - t) / t, 1);
	// Signal strength — dominant-class probability (always the "winning" side)
	const signalStrength = p >= 0.5 ? p : 1 - p;
	// Decision stability — would a ±5pp shift flip the result?
	const distFromThreshold = Math.abs(p - t);
	const stability = Math.min(distFromThreshold / 0.15, 1); // normalized: 15pp+ = fully stable

	// Interpretation
	const getVerdict = () => {
		if (certainty >= 0.7 && stability >= 0.6)
			return { text: 'Strong prediction — high certainty with stable margin from threshold.', color: 'text-emerald-400' };
		if (certainty >= 0.4 && stability >= 0.3)
			return { text: 'Moderate prediction — reasonable certainty but monitor for input sensitivity.', color: 'text-sky-400' };
		if (stability < 0.3)
			return { text: 'Borderline — small input changes could flip the outcome. Treat with caution.', color: 'text-amber-400' };
		return { text: 'Weak signal — probability is close to uncertainty zone. Additional data recommended.', color: 'text-rose-400' };
	};
	const verdict = getVerdict();

	return (
		<View className={`mt-4 rounded-xl border p-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-slate-50'}`}>
			<Text className={`text-[10px] font-semibold uppercase tracking-wide mb-3 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
				Prediction Analytics
			</Text>
			<View className="gap-3">
				<AnalyticsMetric
					label="Certainty"
					value={certainty}
					isDark={isDark}
					description="Distance from 50/50 uncertainty — higher means the model is more decisive"
				/>
				<AnalyticsMetric
					label="Threshold Margin"
					value={margin}
					isDark={isDark}
					description={`Buffer from the ${Math.round(t * 100)}% decision boundary — larger margin = more room for error`}
				/>
				<AnalyticsMetric
					label="Signal Strength"
					value={signalStrength}
					isDark={isDark}
					description="Dominant-class probability — raw strength of the predicted outcome"
				/>
				<AnalyticsMetric
					label="Decision Stability"
					value={stability}
					isDark={isDark}
					description="Resilience to input perturbations — low means small changes could flip the result"
					barColor={stability >= 0.5 ? 'bg-emerald-500' : stability >= 0.25 ? 'bg-amber-500' : 'bg-rose-500'}
				/>
			</View>
			{/* Interpretation */}
			<View className={`mt-3 pt-3 border-t ${isDark ? 'border-slate-800/60' : 'border-slate-200'}`}>
				<Text className={`text-[11px] leading-[16px] ${verdict.color}`}>
					{verdict.text}
				</Text>
			</View>
		</View>
	);
};

const getRiskBadgeStyle = (riskLevel, isDark) => {
	if (riskLevel === 'safe') {
		return isDark
			? { container: 'border-emerald-500/40 bg-emerald-500/10', text: 'text-emerald-100' }
			: { container: 'border-emerald-300 bg-emerald-100', text: 'text-emerald-800' };
	}
	if (riskLevel === 'borderline') {
		return isDark
			? { container: 'border-amber-400/40 bg-amber-400/10', text: 'text-amber-50' }
			: { container: 'border-amber-300 bg-amber-100', text: 'text-amber-800' };
	}
	if (riskLevel === 'watch') {
		return isDark
			? { container: 'border-orange-400/40 bg-orange-500/10', text: 'text-orange-100' }
			: { container: 'border-orange-300 bg-orange-100', text: 'text-orange-800' };
	}
	if (riskLevel === 'unsafe') {
		return isDark
			? { container: 'border-rose-500/60 bg-rose-500/10', text: 'text-rose-100' }
			: { container: 'border-rose-300 bg-rose-100', text: 'text-rose-800' };
	}
	return isDark
		? { container: 'border-slate-700 bg-slate-800/60', text: 'text-slate-200' }
		: { container: 'border-slate-300 bg-slate-100', text: 'text-slate-800' };
};

const getParameterSeverityStyle = (status, isDark) => {
	if (status === 'ok') {
		return isDark
			? { container: 'border-emerald-500/30 bg-emerald-500/5', badge: 'text-emerald-200' }
			: { container: 'border-emerald-300 bg-emerald-50', badge: 'text-emerald-700' };
	}
	if (status === 'warning') {
		return isDark
			? { container: 'border-amber-400/40 bg-amber-500/10', badge: 'text-amber-200' }
			: { container: 'border-amber-300 bg-amber-50', badge: 'text-amber-700' };
	}
	if (status === 'critical') {
		return isDark
			? { container: 'border-rose-500/60 bg-rose-500/10', badge: 'text-rose-200' }
			: { container: 'border-rose-300 bg-rose-50', badge: 'text-rose-700' };
	}
	return isDark
		? { container: 'border-slate-800 bg-slate-900/60', badge: 'text-slate-400' }
		: { container: 'border-slate-200 bg-slate-50', badge: 'text-slate-700' };
};

const formatNumericValue = (value) => {
	if (value === undefined || value === null) {
		return '--';
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return '--';
	}
	return parsed.toFixed(2);
};

const formatRecommendedRange = (range) => {
	if (!Array.isArray(range) || range.length !== 2) {
		return 'range unavailable';
	}
	const [low, high] = range.map((value) => Number(value));
	if (!Number.isFinite(low) || !Number.isFinite(high)) {
		return 'range unavailable';
	}
	return `${low.toFixed(2)} - ${high.toFixed(2)}`;
};

const parameterGroupMeta = {
	core: {
		title: 'Core parameters',
		fields: ['pH', 'hardness', 'solids', 'conductivity'],
	},
	chemical: {
		title: 'Chemical compounds',
		fields: ['chloramines', 'sulfate', 'organic_carbon', 'trihalomethanes'],
	},
	physical: {
		title: 'Physical & disinfectant',
		fields: ['turbidity', 'free_chlorine_residual'],
	},
};

const normalizeFieldKey = (field = '') => field.toLowerCase();

const getMicrobialRiskStyle = (riskLevel, isDark) => {
	if (riskLevel === 'high') {
		return isDark
			? {
				container: 'border-rose-500/60 bg-rose-500/10',
				badge: 'bg-rose-500/20',
				text: 'text-rose-100',
				badgeText: 'text-rose-300',
				icon: '🔴',
			}
			: {
				container: 'border-rose-300 bg-rose-100',
				badge: 'bg-rose-200',
				text: 'text-rose-800',
				badgeText: 'text-rose-800',
				icon: '🔴',
			};
	}
	if (riskLevel === 'medium') {
		return isDark
			? {
				container: 'border-amber-400/40 bg-amber-400/10',
				badge: 'bg-amber-500/20',
				text: 'text-amber-100',
				badgeText: 'text-amber-300',
				icon: '🟡',
			}
			: {
				container: 'border-amber-300 bg-amber-100',
				badge: 'bg-amber-200',
				text: 'text-amber-800',
				badgeText: 'text-amber-800',
				icon: '🟡',
			};
	}
	return isDark
		? {
			container: 'border-emerald-500/40 bg-emerald-500/10',
			badge: 'bg-emerald-500/20',
			text: 'text-emerald-100',
			badgeText: 'text-emerald-300',
			icon: '🟢',
		}
		: {
			container: 'border-emerald-300 bg-emerald-100',
			badge: 'bg-emerald-200',
			text: 'text-emerald-800',
			badgeText: 'text-emerald-800',
			icon: '🟢',
		};
};

const FIELD_DISPLAY_NAMES = {
	ph: 'pH',
	hardness: 'Hardness',
	solids: 'Total Dissolved Solids',
	chloramines: 'Chloramines',
	sulfate: 'Sulfate',
	conductivity: 'Conductivity',
	organic_carbon: 'Organic Carbon (TOC)',
	trihalomethanes: 'Trihalomethanes',
	turbidity: 'Turbidity',
};

const RISK_SUMMARIES = {
	high: 'Multiple WHO thresholds exceeded. Confirmatory lab testing strongly recommended.',
	medium: 'Some thresholds exceeded. Follow-up monitoring advised.',
	low: 'All parameters within acceptable ranges.',
};

/** Build a frequency map: bacterium → list of source parameter names */
const buildBacteriaFrequency = (violations) => {
	const freq = {};
	for (const v of violations) {
		for (const b of v.bacteria || []) {
			if (!freq[b]) freq[b] = [];
			freq[b].push(v.field);
		}
	}
	// Sort by number of sources (most cross-referenced first)
	return Object.entries(freq).sort((a, b) => b[1].length - a[1].length);
};

const MicrobialRiskSection = ({ result, children, isDark = true }) => {
	const riskLevel = result?.microbialRiskLevel || result?.microbial_risk_level;

	// Debug: log to console so we can verify data presence
	console.log('[MicrobialRiskSection] riskLevel:', riskLevel, '| keys:', result ? Object.keys(result).filter(k => k.toLowerCase().includes('microbial') || k.toLowerCase().includes('bacteria')) : 'no result');

	if (!riskLevel) {
		return (
			<View className={`mt-6 rounded-[28px] border p-4 ${isDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
				<Text className={`text-[12px] font-semibold uppercase tracking-wide ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
					Microbial Risk
				</Text>
				<Text className={`text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
					Risk data unavailable. Check backend connection.
				</Text>
			</View>
		);
	}

	const style = getMicrobialRiskStyle(riskLevel, isDark);
	const violations = result?.microbialViolations || result?.microbial_violations || [];
	const bacteria = result?.possibleBacteria || result?.possible_bacteria || [];
	const probabilities = result?.microbialRiskProbabilities || result?.microbial_risk_probabilities || {};
	const score = result?.microbialScore ?? result?.microbial_score ?? 0;
	const maxScore = result?.microbialMaxScore ?? result?.microbial_max_score ?? 14;
	const bacteriaFreq = buildBacteriaFrequency(violations);

	return (
		<View className="mt-6">
			{/* ─── Risk Header Card ─── */}
			<View className={`rounded-[28px] border p-5 ${style.container}`}>
				<View className="flex-row items-center justify-between mb-1">
					<Text className={`text-[13px] font-bold uppercase tracking-[3px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
						Microbial Risk
					</Text>
					<View className={`rounded-full px-3.5 py-1.5 ${style.badge}`}>
						<Text className={`text-[12px] font-bold uppercase tracking-wide ${style.badgeText}`}>
							{style.icon}  {riskLevel}
						</Text>
					</View>
				</View>

				{/* Summary sentence */}
				<Text className={`mt-2 text-[12px] leading-[18px] ${style.text}`}>
					{RISK_SUMMARIES[riskLevel]}
				</Text>

				{/* Score gauge */}
				<View className="mt-4">
					<View className="flex-row items-center justify-between mb-1.5">
						<Text className={`text-[10px] font-semibold uppercase tracking-wide ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
							Composite Risk Score
						</Text>
						<Text className={`text-[13px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{score} / {maxScore}</Text>
					</View>
					<View className={`h-3 rounded-full overflow-hidden flex-row ${isDark ? 'bg-slate-800/80' : 'bg-slate-200'}`}>
						{/* Segmented gauge: green → amber → red */}
						{[
							{ pct: Math.min(score / maxScore, 0.2) / 0.2, color: 'bg-emerald-500', width: 20 },
							{ pct: Math.max(0, Math.min((score / maxScore - 0.2) / 0.2, 1)), color: 'bg-amber-500', width: 20 },
							{ pct: Math.max(0, Math.min((score / maxScore - 0.4) / 0.6, 1)), color: 'bg-rose-500', width: 60 },
						].map((seg, i) => (
							<View key={i} className={`h-full ${isDark ? 'bg-slate-800/40' : 'bg-slate-200'}`} style={{ width: `${seg.width}%` }}>
								{seg.pct > 0 && (
									<View className={`h-full ${seg.color}`} style={{ width: `${Math.min(seg.pct * 100, 100)}%` }} />
								)}
							</View>
						))}
					</View>
					<View className="flex-row justify-between mt-1">
						<Text className="text-[9px] text-emerald-600">Low</Text>
						<Text className="text-[9px] text-amber-600">Medium</Text>
						<Text className="text-[9px] text-rose-600">High</Text>
					</View>
				</View>

				{/* ML class probabilities */}
				{Object.keys(probabilities).length > 0 && (
					<View className={`mt-4 rounded-xl border p-3 ${isDark ? 'border-slate-800/50 bg-slate-900/50' : 'border-slate-200 bg-white/80'}`}>
						<Text className={`text-[10px] font-semibold uppercase tracking-wide mb-2 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
							ML Model Prediction
						</Text>
						<View className="gap-2">
							{['low', 'medium', 'high'].map((level) => {
								const prob = probabilities[level] || 0;
								const isSelected = level === riskLevel;
								const barStyle = level === 'high' ? 'bg-rose-500' : level === 'medium' ? 'bg-amber-500' : 'bg-emerald-500';
								return (
									<View key={level} className="flex-row items-center gap-2.5">
										<View className="w-[52px] flex-row items-center gap-1">
											{isSelected && <View className={`w-1.5 h-1.5 rounded-full ${barStyle}`} />}
											<Text className={`text-[10px] capitalize ${isSelected ? (isDark ? 'font-bold text-slate-200' : 'font-bold text-slate-800') : (isDark ? 'text-slate-500' : 'text-slate-600')}`}>
												{level}
											</Text>
										</View>
										<View className={`flex-1 h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
											<View className={`h-full rounded-full ${barStyle} ${isSelected ? 'opacity-100' : 'opacity-40'}`}
												style={{ width: `${Math.round(prob * 100)}%` }}
											/>
										</View>
										<Text className={`text-[11px] w-11 text-right ${isSelected ? (isDark ? 'font-bold text-slate-200' : 'font-bold text-slate-800') : (isDark ? 'text-slate-500' : 'text-slate-600')}`}>
											{Math.round(prob * 100)}%
										</Text>
									</View>
								);
							})}
						</View>
					</View>
				)}
			</View>

			{/* ─── Injected content (e.g. Filtration chatbot) ─── */}
			{children}

			{/* ─── Violations Detail ─── */}
			{violations.length > 0 && (
				<View className={`mt-4 rounded-[28px] border p-5 ${isDark ? 'border-slate-900 bg-slate-900/70' : 'border-slate-200 bg-white'}`}>
					<Text className={`text-[12px] font-semibold uppercase tracking-wide mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
						WHO Threshold Violations
					</Text>
					<Text className={`text-[10px] mb-4 ${isDark ? 'text-slate-600' : 'text-slate-500'}`}>
						{violations.length} parameter{violations.length > 1 ? 's' : ''} exceeded safe thresholds
					</Text>

					<View className="gap-3">
						{violations.map((v, i) => {
							const fieldName = FIELD_DISPLAY_NAMES[v.field] || v.field;
							const unit = v.unit || '';
							const weightDots = '●'.repeat(v.weight) + '○'.repeat(3 - Math.min(v.weight, 3));

							return (
								<View key={i} className={`rounded-2xl border overflow-hidden ${isDark ? 'border-slate-800/60 bg-slate-900/40' : 'border-slate-200 bg-slate-50'}`}>
									{/* Violation header */}
									<View className="flex-row items-center justify-between px-4 pt-3 pb-2">
										<View className="flex-1">
											<Text className={`text-[13px] font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{fieldName}</Text>
											<Text className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>{v.rule}</Text>
										</View>
										<View className="items-end">
											<Text className={`text-[14px] font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
												{v.value != null ? Number(v.value).toFixed(2) : '—'}
												{unit ? <Text className={`text-[10px] font-normal ${isDark ? 'text-slate-500' : 'text-slate-600'}`}> {unit}</Text> : null}
											</Text>
											<Text className={`text-[9px] mt-0.5 ${isDark ? 'text-slate-600' : 'text-slate-500'}`}>severity {weightDots}</Text>
										</View>
									</View>

									{/* Health risk & biofilm */}
									{(v.healthRisk || v.health_risk || v.biofilm) ? (
										<View className="px-4 pb-2 gap-1">
											{(v.healthRisk || v.health_risk) ? (
												<View className="flex-row items-start gap-1.5">
													<Text className="text-[10px] text-rose-400 mt-px">⚕</Text>
													<Text className={`text-[10px] flex-1 ${isDark ? 'text-slate-400' : 'text-slate-700'}`}>
														<Text className={`${isDark ? 'text-slate-500' : 'text-slate-600'} font-semibold`}>Health risk: </Text>
														{v.healthRisk || v.health_risk}
													</Text>
												</View>
											) : null}
											{v.biofilm ? (
												<View className="flex-row items-start gap-1.5">
													<Text className="text-[10px] text-sky-400 mt-px">◎</Text>
													<Text className={`text-[10px] flex-1 ${isDark ? 'text-slate-400' : 'text-slate-700'}`}>
														<Text className={`${isDark ? 'text-slate-500' : 'text-slate-600'} font-semibold`}>Biofilm: </Text>
														{v.biofilm}
													</Text>
												</View>
											) : null}
										</View>
									) : null}

									{/* Bacteria from this violation */}
									{(v.bacteria || []).length > 0 && (
										<View className="px-4 pb-3 pt-1">
											<View className="flex-row flex-wrap gap-1.5">
												{v.bacteria.map((b, j) => (
													<View key={j} className={`rounded-full border px-2 py-0.5 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'}`}>
														<Text className={`text-[9px] font-medium italic ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{b}</Text>
													</View>
												))}
											</View>
										</View>
									)}
								</View>
							);
						})}
					</View>
				</View>
			)}

			{/* ─── Bacteria Cross-Reference Panel ─── */}
			{bacteriaFreq.length > 0 && (
				<View className={`mt-4 rounded-[28px] border p-5 ${isDark ? 'border-slate-900 bg-slate-900/70' : 'border-slate-200 bg-white'}`}>
					<Text className={`text-[12px] font-semibold uppercase tracking-wide mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
						Possible Microbial Concerns
					</Text>
					<Text className={`text-[10px] mb-4 ${isDark ? 'text-slate-600' : 'text-slate-500'}`}>
						{bacteriaFreq.length} organism{bacteriaFreq.length > 1 ? 's' : ''} identified from {violations.length} violation{violations.length > 1 ? 's' : ''}
					</Text>

					<View className="gap-2.5">
						{bacteriaFreq.map(([bacterium, sources], i) => {
							const crossRefCount = sources.length;
							const threatLevel = crossRefCount >= 3 ? 'high' : crossRefCount >= 2 ? 'medium' : 'low';
							const threatColors = {
								high: { border: 'border-rose-500/40', bg: 'bg-rose-500/10', dot: 'bg-rose-500', text: isDark ? 'text-rose-300' : 'text-rose-700' },
								medium: { border: 'border-amber-400/30', bg: 'bg-amber-500/10', dot: 'bg-amber-500', text: isDark ? 'text-amber-300' : 'text-amber-700' },
								low: { border: isDark ? 'border-slate-700/60' : 'border-slate-200', bg: isDark ? 'bg-slate-900/40' : 'bg-slate-50', dot: 'bg-slate-500', text: isDark ? 'text-slate-400' : 'text-slate-600' },
							};
							const tc = threatColors[threatLevel];

							return (
								<View key={i} className={`rounded-xl border ${tc.border} ${tc.bg} px-3.5 py-2.5`}>
									<View className="flex-row items-center justify-between">
										<View className="flex-row items-center gap-2 flex-1">
											<View className={`w-2 h-2 rounded-full ${tc.dot}`} />
											<Text className={`text-[12px] font-semibold italic flex-1 ${isDark ? 'text-slate-200' : 'text-slate-800'}`} numberOfLines={1}>
												{bacterium}
											</Text>
										</View>
										<View className={`rounded-full px-2 py-0.5 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
											<Text className={`text-[9px] font-bold ${tc.text}`}>
												{crossRefCount} source{crossRefCount > 1 ? 's' : ''}
											</Text>
										</View>
									</View>
									<View className="flex-row flex-wrap gap-1 mt-1.5">
										{sources.map((src, j) => (
											<Text key={j} className={`text-[9px] rounded px-1.5 py-0.5 ${isDark ? 'text-slate-500 bg-slate-800/60' : 'text-slate-600 bg-slate-100'}`}>
												{FIELD_DISPLAY_NAMES[src] || src}
											</Text>
										))}
									</View>
								</View>
							);
						})}
					</View>
				</View>
			)}

			{violations.length === 0 && (
				<View
					className={`mt-4 rounded-2xl border px-4 py-3 ${
						isDark ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-emerald-300 bg-emerald-100'
					}`}
				>
					<View className="flex-row items-center gap-2">
						<Text className="text-[14px]">✓</Text>
						<Text className={`text-[12px] font-semibold ${isDark ? 'text-emerald-200' : 'text-emerald-800'}`}>
							All parameters within WHO thresholds
						</Text>
					</View>
				</View>
			)}
		</View>
	);
};

/* ─── Filtration suggestion card + chat modal ─── */
const FiltrationChatCard = ({ result, isDark = true }) => {
	const [suggestion, setSuggestion] = useState(null);
	const [suggestionLoading, setSuggestionLoading] = useState(false);
	const [suggestionError, setSuggestionError] = useState('');
	const [chatOpen, setChatOpen] = useState(false);
	const [chatHistory, setChatHistory] = useState([]);
	const [chatInput, setChatInput] = useState('');
	const [chatLoading, setChatLoading] = useState(false);
	const chatScrollRef = useRef(null);

	useEffect(() => {
		if (!result) return;
		let cancelled = false;
		setSuggestionLoading(true);
		setSuggestionError('');
		getFiltrationSuggestion(result)
			.then((r) => { if (!cancelled) setSuggestion(r.suggestion); })
			.catch((e) => { if (!cancelled) setSuggestionError(e?.message || 'Failed to get suggestion'); })
			.finally(() => { if (!cancelled) setSuggestionLoading(false); });
		return () => { cancelled = true; };
	}, []);

	const handleSendChat = useCallback(async () => {
		const trimmed = chatInput.trim();
		if (!trimmed || chatLoading) return;
		const newHistory = [...chatHistory, { role: 'user', text: trimmed }];
		setChatHistory(newHistory);
		setChatInput('');
		setChatLoading(true);
		try {
			const resp = await chatWithGemini(result, newHistory, trimmed);
			setChatHistory((prev) => [...prev, { role: 'assistant', text: resp.reply }]);
		} catch (e) {
			setChatHistory((prev) => [...prev, { role: 'assistant', text: `Error: ${e?.message || 'Request failed'}` }]);
		} finally {
			setChatLoading(false);
			setTimeout(() => chatScrollRef.current?.scrollToEnd?.({ animated: true }), 100);
		}
	}, [chatInput, chatLoading, chatHistory, result]);

	const sendEnabled = !chatLoading && chatInput.trim().length > 0;

	return (
		<View className={`mt-4 rounded-[28px] border p-5 ${isDark ? 'border-sky-500/30 bg-sky-900/40' : 'border-sky-200 bg-sky-50'}`}>
			<View className="flex-row items-center justify-between mb-2">
				<View className="flex-row items-center gap-2">
					<Text className="text-[14px]">💧</Text>
					<Text className={`text-[12px] font-semibold uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
						Filtration Advice
					</Text>
				</View>
				<View className="rounded-full border border-sky-500/40 px-2 py-0.5">
					<Text className={`text-[9px] font-semibold ${isDark ? 'text-sky-400' : 'text-sky-700'}`}>GEMINI AI</Text>
				</View>
			</View>

			{suggestionLoading ? (
				<View className="items-center py-4">
					<ActivityIndicator color="#38bdf8" size="small" />
					<Text className={`text-[11px] mt-2 ${isDark ? 'text-sky-400' : 'text-sky-700'}`}>Analyzing treatment options...</Text>
				</View>
			) : suggestionError ? (
				<View>
					<Text className="text-[11px] text-rose-400">{suggestionError}</Text>
					<TouchableOpacity
						activeOpacity={0.85}
						onPress={() => {
							setSuggestionError('');
							setSuggestionLoading(true);
							getFiltrationSuggestion(result)
								.then((r) => setSuggestion(r.suggestion))
								.catch((e) => setSuggestionError(e?.message || 'Failed'))
								.finally(() => setSuggestionLoading(false));
						}}
						className="mt-2 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 self-start"
					>
						<Text className="text-[11px] font-semibold text-sky-300">Retry</Text>
					</TouchableOpacity>
				</View>
			) : suggestion ? (
				<Text className={`text-[12px] leading-[18px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{suggestion}</Text>
			) : null}

			{/* Button to open chat modal */}
			<TouchableOpacity
				activeOpacity={0.85}
				onPress={() => setChatOpen(true)}
				className={`mt-4 rounded-2xl border px-4 py-3 ${isDark ? 'border-slate-700 bg-slate-900/70' : 'border-slate-300 bg-white'}`}
			>
				<Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
					Ask about treatment methods, costs, or WHO guidelines...
				</Text>
			</TouchableOpacity>

			{/* ─── Chat Modal ─── */}
			<Modal
				visible={chatOpen}
				animationType="fade"
				transparent
				onRequestClose={() => setChatOpen(false)}
			>
				<View className={`flex-1 px-5 py-10 ${isDark ? 'bg-black/70' : 'bg-slate-900/45'}`}>
					<View className="flex-1 justify-center">
						<View className={`max-h-[85%] rounded-[32px] border p-5 ${isDark ? 'border-sky-900/80 bg-slate-950/95' : 'border-sky-200 bg-white'}`}>
							{/* Header */}
							<View className="flex-row items-center justify-between">
								<View>
									<Text className={`text-[16px] font-semibold ${isDark ? 'text-sky-50' : 'text-sky-900'}`}>
										AquaScope Copilot
									</Text>
									<Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
										Filtration & treatment assistant
									</Text>
								</View>
								<TouchableOpacity
									accessibilityRole="button"
									accessibilityLabel="Close chat"
									activeOpacity={0.8}
									onPress={() => setChatOpen(false)}
									className={`h-10 w-10 items-center justify-center rounded-full border ${isDark ? 'border-slate-800/70' : 'border-slate-300'}`}
								>
									<Text className={`text-[16px] font-semibold ${isDark ? 'text-sky-100' : 'text-sky-900'}`}>✕</Text>
								</TouchableOpacity>
							</View>

							{/* Messages */}
							<ScrollView
								ref={chatScrollRef}
								className="mt-4"
								contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
								showsVerticalScrollIndicator={false}
								style={{ maxHeight: 360 }}
							>
								{chatHistory.length === 0 && (
									<Text className={`text-[11px] py-3 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
										Ask about treatment methods, cost alternatives, or WHO guidelines for this sample.
									</Text>
								)}
								{chatHistory.map((msg, i) => (
									<View
										key={i}
										className={msg.role === 'user'
											? `max-w-[85%] rounded-2xl px-4 py-3 self-end ${isDark ? 'bg-sky-500/15 border border-sky-500/30' : 'bg-sky-100 border border-sky-300'}`
											: `max-w-[85%] rounded-2xl px-4 py-3 self-start border ${isDark ? 'border-slate-800/80 bg-slate-900/80' : 'border-slate-200 bg-slate-100'}`
										}
									>
										<Text className={`text-[13px] leading-[18px] ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>{msg.text}</Text>
									</View>
								))}
								{chatLoading && (
									<View className="self-start flex-row items-center gap-2 px-3 py-2">
										<ActivityIndicator color="#38bdf8" size="small" />
										<Text className="text-[10px] text-sky-400">Thinking...</Text>
									</View>
								)}
							</ScrollView>

							{/* Input */}
							<View className="mt-4 flex-row items-center gap-3">
								<TextInput
									className={`flex-1 rounded-2xl border px-4 py-3 ${isDark ? 'border-slate-800/70 bg-slate-900/80 text-sky-100' : 'border-slate-300 bg-white text-slate-900'}`}
									placeholder="Ask about filtration..."
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
									className={sendEnabled
										? `rounded-2xl border border-sky-400/60 px-4 py-3 ${isDark ? 'bg-sky-500/80' : 'bg-sky-500/90'}`
										: `rounded-2xl px-4 py-3 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`
									}
									disabled={!sendEnabled}
								>
									<Text className={sendEnabled
										? 'text-[13px] font-semibold text-slate-950'
										: `text-[13px] font-semibold ${isDark ? 'text-slate-600' : 'text-slate-500'}`
									}>Send</Text>
								</TouchableOpacity>
							</View>
						</View>
					</View>
				</View>
			</Modal>
		</View>
	);
};

const WaterResultScreen = ({ visible, onClose, result }) => {
	const { isDark } = useAppTheme();
	if (!result) {
		return null;
	}

	const riskStyle = getRiskBadgeStyle(result.riskLevel, isDark);
	const timestampLabel = result.timestamp
		? new Date(result.timestamp).toLocaleString()
		: 'timestamp pending';
	const missingFeatures = result.missingFeatures || [];
	const groupedChecks = Object.values(parameterGroupMeta).map((group) => ({
		title: group.title,
		checks: (result.checks || []).filter((check) =>
			group.fields.some((field) => normalizeFieldKey(field) === normalizeFieldKey(check.field))
		),
	}));

	return (
		<Modal
			visible={visible}
			animationType="slide"
			transparent={false}
			presentationStyle="fullScreen"
			onRequestClose={onClose}
		>
			<SafeAreaView className={`flex-1 ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
				<View className={`flex-row items-center justify-between border-b px-5 py-4 ${isDark ? 'border-slate-900' : 'border-slate-300'}`}>
						<Text className={`text-[12px] font-semibold uppercase tracking-[4px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Potability verdict</Text>
						<TouchableOpacity
							accessibilityRole="button"
							onPress={onClose}
							className={`rounded-full border px-4 py-1.5 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-300 bg-white'}`}
							activeOpacity={0.85}
						>
							<Text className={`text-[12px] font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>Close</Text>
						</TouchableOpacity>
					</View>

					<ScrollView
						className="flex-1 px-5"
						contentContainerStyle={{ paddingBottom: 32 }}
						showsVerticalScrollIndicator={false}
					>
						<View className={`mt-5 rounded-[30px] border p-5 ${isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-200 bg-white'}`}>
							<View className="flex-row items-center justify-between">
								<Text className={`text-[28px] font-semibold ${isDark ? 'text-sky-50' : 'text-sky-900'}`}>
									{result.isPotable ? 'Potable' : 'Not potable'}
								</Text>
								<View className={`rounded-full px-3 py-1 ${riskStyle.container}`}>
									<Text className={`text-[11px] font-semibold uppercase ${riskStyle.text}`}>
										{result.riskLevel || 'pending'}
									</Text>
								</View>
							</View>
							<Text className={`mt-2 text-[13px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{result.message}</Text>
							<View className="mt-4 items-center justify-center">
								<LottieView
									source={getConfidenceAnimation(result.probability)}
									autoPlay
									loop
									resizeMode="contain"
									style={{ width: GAUGE_WIDTH, height: GAUGE_WIDTH * 0.7 }}
								/>
							</View>
							<View className={`mt-4 rounded-2xl border px-4 py-3 ${isDark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-slate-50'}`}>
								<ConfidenceGauge probability={result.probability} threshold={0.5} isDark={isDark} />
								<View className={`mt-4 pt-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
									<Text className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
									{timestampLabel} · {result.modelVersion}{result.sampleId ? ` · #${result.sampleId.slice(0, 8)}` : ''}
								</Text>
								</View>
							</View>
						<Text className={`mt-3 text-[11px] ${result.saved ? (isDark ? 'text-emerald-400' : 'text-emerald-700') : (isDark ? 'text-slate-500' : 'text-slate-600')}`}>
							{result.saved ? '● Synced' : '○ Not synced'}
							</Text>
						</View>
						{/* Microbial Risk Assessment — placed immediately after potability verdict */}
						<MicrobialErrorBoundary isDark={isDark}>
							<MicrobialRiskSection result={result} isDark={isDark}>
								<FiltrationChatCard result={result} isDark={isDark} />
							</MicrobialRiskSection>
						</MicrobialErrorBoundary>

						{groupedChecks.map((group) => (
							<View key={group.title} className={`mt-6 rounded-[28px] border p-5 ${isDark ? 'border-slate-900 bg-slate-950/70' : 'border-slate-200 bg-white'}`}>
								<Text className={`text-[12px] font-semibold uppercase tracking-wide ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
									{group.title}
								</Text>
								{group.checks.length ? (
									<View className="mt-3 gap-3">
										{group.checks.map((check) => {
											const severity = getParameterSeverityStyle(check.status, isDark);
											return (
												<View
													key={check.field}
													className={`rounded-2xl border px-4 py-3 ${severity.container}`}
												>
													<View className="flex-row items-center justify-between">
														<Text className={`text-[13px] font-semibold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}>{check.label}</Text>
														<Text className={`text-[11px] font-semibold uppercase ${severity.badge}`}>
															{(check.status || 'pending').toUpperCase()}
														</Text>
													</View>
													<Text className={`mt-1 text-[12px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
														Observed {formatNumericValue(check.value)} · Recommended {formatRecommendedRange(check.recommendedRange)}
													</Text>
													<Text className={`mt-1 text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{check.detail}</Text>
													{typeof check.zScore === 'number' && Number.isFinite(check.zScore) ? (
														<Text className={`mt-0.5 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>Z-score {check.zScore.toFixed(2)}</Text>
													) : null}
												</View>
											);
										})}
									</View>
								) : (
									<Text className={`mt-3 text-[12px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>No readings in this section.</Text>
								)}
							</View>
						))}

						{missingFeatures.length ? (
							<View className={`mt-6 rounded-[24px] border p-4 ${isDark ? 'border-amber-500/30 bg-amber-500/5' : 'border-amber-300 bg-amber-50'}`}>
								<Text className={`text-[12px] font-semibold uppercase tracking-wide ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
									Missing inputs
								</Text>
								<View className="mt-3 flex-row flex-wrap gap-2">
									{missingFeatures.map((field) => (
										<View key={field} className={`rounded-full border px-3 py-1 ${isDark ? 'border-amber-300/40 bg-amber-300/10' : 'border-amber-300 bg-amber-100'}`}>
											<Text className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-amber-100' : 'text-amber-800'}`}>
												{field}
											</Text>
										</View>
									))}
								</View>
							</View>
						) : null}

					</ScrollView>
				</SafeAreaView>
		</Modal>
	);
};

export default WaterResultScreen;
