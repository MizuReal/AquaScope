import React from 'react';
import { TouchableOpacity, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../utils/theme';

/**
 * PredictButton
 * Props:
 *   title       — button label
 *   onPress     — press handler
 *   className   — extra Tailwind classes for the outer TouchableOpacity
 *   textClassName — extra classes for the label Text
 *   disabled    — disables the button
 *   icon        — MaterialCommunityIcons name (optional)
 *   iconSize    — defaults to 18
 *   iconColor   — override icon colour (defaults to the label colour)
 *   iconRight   — place icon after the label instead of before
 */
const PredictButton = ({
	title = 'Predict',
	onPress,
	className,
	textClassName,
	disabled,
	icon,
	iconSize = 18,
	iconColor,
	iconRight = false,
}) => {
	const { isDark } = useAppTheme();
	const labelColor = isDark ? '#0f172a' : '#ffffff';
	const resolvedIconColor = iconColor || labelColor;

	return (
		<TouchableOpacity
			className={`w-full rounded-full py-3 items-center justify-center flex-row ${
				disabled
					? isDark
						? 'bg-aquaaccent/70 opacity-70'
						: 'bg-sky-300 opacity-70'
					: isDark
					? 'bg-aquaprimary'
					: 'bg-sky-500'
			} ${className || ''}`}
			onPress={onPress}
			activeOpacity={0.8}
			disabled={disabled}
		>
			{icon && !iconRight ? (
				<View style={{ marginRight: 7 }}>
					<MaterialCommunityIcons name={icon} size={iconSize} color={resolvedIconColor} />
				</View>
			) : null}
			<Text
				className={`text-[15px] font-semibold ${isDark ? 'text-slate-950' : 'text-white'} ${
					textClassName || ''
				}`}
			>
				{title}
			</Text>
			{icon && iconRight ? (
				<View style={{ marginLeft: 7 }}>
					<MaterialCommunityIcons name={icon} size={iconSize} color={resolvedIconColor} />
				</View>
			) : null}
		</TouchableOpacity>
	);
};

export default PredictButton;
