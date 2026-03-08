import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
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
		backgroundColor: '#f7f7f7',
		borderBottomWidth: 1,
		borderBottomColor: '#ddd',
		paddingHorizontal: 12,
		paddingVertical: 10,
	},
	row: {
		flexDirection: 'row',
		marginBottom: 4,
	},
	label: {
		fontSize: 12,
		fontWeight: '600',
		color: '#333',
		marginRight: 6,
	},
	value: {
		fontSize: 12,
		color: '#666',
		fontFamily: 'monospace',
	},
	button: {
		marginTop: 8,
		backgroundColor: '#0a84ff',
		paddingVertical: 6,
		paddingHorizontal: 12,
		borderRadius: 6,
		alignSelf: 'flex-start',
	},
	buttonText: {
		color: '#fff',
		fontSize: 12,
		fontWeight: '600',
	},
});
