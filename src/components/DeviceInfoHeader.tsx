import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet, Platform } from 'react-native';
import type { MeshManager } from '@/services/mesh/MeshManager';

type Props = {
	meshManager: MeshManager;
};

function maskKey(key: string | null): string {
	if (!key) return '(none)';
	if (key.length <= 8) return key;
	return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export const DeviceInfoHeader: React.FC<Props> = ({ meshManager }) => {
	const [deviceId] = useState(meshManager.getDeviceId());
	const [deviceKey, setDeviceKey] = useState<string | null>(meshManager.getDeviceKey());

	useEffect(() => {
		const unsub = meshManager.onKeyChanged((newKey) => {
			setDeviceKey(newKey);
		});
		return () => {
			unsub();
		};
	}, [meshManager]);

	const handleGenerateNewKey = async () => {
		const newKey = await meshManager.regenerateDeviceKey();
		setDeviceKey(newKey);
	};

	return (
		<View style={styles.container}>
			<View style={styles.row}>
				<Text style={styles.label}>Device ID:</Text>
				<Text style={styles.value}>{deviceId}</Text>
			</View>
			<View style={styles.row}>
				<Text style={styles.label}>Key:</Text>
				<Text style={styles.value}>{maskKey(deviceKey)}</Text>
			</View>
			<TouchableOpacity style={styles.button} onPress={handleGenerateNewKey}>
				<Text style={styles.buttonText}>Generate New Key</Text>
			</TouchableOpacity>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		backgroundColor: '#18181b',
		borderBottomWidth: 1,
		borderBottomColor: '#27272a',
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	row: {
		flexDirection: 'row',
		marginBottom: 6,
		alignItems: 'center',
	},
	label: {
		fontSize: 12,
		fontWeight: '600',
		color: '#a1a1aa',
		marginRight: 8,
		width: 70,
	},
	value: {
		fontSize: 12,
		color: '#f4f4f5',
		fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
		fontWeight: '500',
	},
	button: {
		marginTop: 6,
		backgroundColor: '#27272a',
		borderWidth: 1,
		borderColor: '#3f3f46',
		paddingVertical: 6,
		paddingHorizontal: 12,
		borderRadius: 6,
		alignSelf: 'flex-start',
	},
	buttonText: {
		color: '#e4e4e7',
		fontSize: 12,
		fontWeight: '600',
	},
});
