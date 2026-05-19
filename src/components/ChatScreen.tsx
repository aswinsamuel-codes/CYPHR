import React, { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View, Alert, StyleSheet } from 'react-native';
import type { MeshManager } from '@/services/mesh/MeshManager';
import { Storage } from '@/services/storage/Storage';
import { format } from 'date-fns';
import * as Location from 'expo-location';

type Props = {
	meshManager: MeshManager;
	storage: typeof Storage;
};

export type ChatMessage = {
	id: string;
	senderId: string;
	recipientId: string | 'broadcast';
	text: string;
	timestamp: number;
	status: 'queued' | 'sent' | 'delivered' | 'relayed';
};

interface SOSDetails {
	isSos: boolean;
	coords: {
		lat: string;
		lng: string;
		alt: string;
		acc: string;
	} | null;
	message: string;
}

// Parses the structured SOS Beacon text format safely
const parseSOSMessage = (text: string): SOSDetails => {
	const isSos = text.startsWith('🚨 [SOS BEACON] 🚨');
	if (!isSos) return { isSos: false, coords: null, message: text };

	const lines = text.split('\n');
	let lat = '';
	let lng = '';
	let alt = '';
	let acc = '';
	let message = '';

	for (const line of lines) {
		if (line.startsWith('Lat:')) {
			const parts = line.replace('Lat:', '').split(', Lng:');
			lat = parts[0]?.trim() || '';
			lng = parts[1]?.trim() || '';
		} else if (line.startsWith('Alt:')) {
			const parts = line.replace('Alt:', '').split('| Acc:');
			alt = parts[0]?.trim() || '';
			acc = parts[1]?.trim() || '';
		} else if (line.startsWith('Message:')) {
			message = line.replace('Message:', '').trim();
		}
	}

	return {
		isSos: true,
		coords: { lat, lng, alt, acc },
		message: message || 'Emergency distress signal broadcasted!'
	};
};

// Simple pulsing-like dot indicator component using standard CSS style/state
const PulsingDot: React.FC = () => {
	const [active, setActive] = useState(true);

	useEffect(() => {
		const interval = setInterval(() => {
			setActive((prev) => !prev);
		}, 800);
		return () => clearInterval(interval);
	}, []);

	return (
		<View
			style={[
				styles.pulsingDot,
				{ backgroundColor: active ? '#ef4444' : '#7f1d1d' }
			]}
		/>
	);
};

export const ChatScreen: React.FC<Props> = ({ meshManager, storage }) => {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState('');
	const [deviceId] = useState(meshManager.getDeviceId());
	const [isLocating, setIsLocating] = useState(false);
	const inputRef = useRef<TextInput | null>(null);

	useEffect(() => {
		const init = async () => {
			const loaded = await storage.getAllMessages();
			setMessages(loaded);
		};
		init();

		const unsubIncoming = meshManager.onMessage(async (msg) => {
			await storage.saveMessage(msg);
			setMessages((prev) => [msg, ...prev]);
		});
		const unsubStatus = meshManager.onStatusUpdate(async (id, status) => {
			setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
			await storage.updateStatus(id, status);
		});
		return () => {
			unsubIncoming();
			unsubStatus();
		};
	}, [meshManager, storage]);

	const send = async () => {
		const text = input.trim();
		if (!text) return;
		setInput('');
		const msg = await meshManager.sendText(text);
		await storage.saveMessage(msg);
		setMessages((prev) => [msg, ...prev]);
	};

	const sendSOS = async () => {
		Alert.alert(
			'🆘 Broadcast SOS Beacon?',
			'This will fetch your high-accuracy GPS coordinates and broadcast an emergency distress signal to all nearby mesh nodes.',
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Broadcast SOS',
					style: 'destructive',
					onPress: async () => {
						setIsLocating(true);
						try {
							const { status } = await Location.requestForegroundPermissionsAsync();
							if (status !== 'granted') {
								Alert.alert('Permission Denied', 'CYPHR needs GPS location permissions to construct an SOS distress beacon.');
								setIsLocating(false);
								return;
							}

							const location = await Location.getCurrentPositionAsync({
								accuracy: Location.Accuracy.Balanced,
							});

							const lat = location.coords.latitude.toFixed(6);
							const lng = location.coords.longitude.toFixed(6);
							const alt = location.coords.altitude ? Math.round(location.coords.altitude).toString() : 'N/A';
							const acc = Math.round(location.coords.accuracy || 0).toString();

							const customMsg = input.trim();
							const sosText = customMsg || 'Distress signal broadcasted — emergency assistance needed!';
							const formattedText = `🚨 [SOS BEACON] 🚨\nLat: ${lat}, Lng: ${lng}\nAlt: ${alt}m | Acc: ±${acc}m\nMessage: ${sosText}`;

							setInput('');
							if (inputRef.current) {
								inputRef.current.blur();
							}

							const msg = await meshManager.sendText(formattedText, 'broadcast');
							await storage.saveMessage(msg);
							setMessages((prev) => [msg, ...prev]);
						} catch (err: any) {
							Alert.alert('Location Error', 'Unable to fetch coordinates: ' + err.message);
						} finally {
							setIsLocating(false);
						}
					}
				}
			]
		);
	};

	const renderItem = ({ item }: { item: ChatMessage }) => {
		const isMe = item.senderId === deviceId;
		const parsed = parseSOSMessage(item.text);

		if (parsed.isSos && parsed.coords) {
			// Render Premium SOS Emergency Beacon Card
			return (
				<View style={styles.sosCard}>
					<View style={styles.sosHeader}>
						<View style={{ flexDirection: 'row', alignItems: 'center' }}>
							<PulsingDot />
							<Text style={styles.sosBadgeText}>EMERGENCY DISTRESS BEACON</Text>
						</View>
						<Text style={styles.sosHopsText}>relayed: {item.status}</Text>
					</View>

					<Text style={styles.sosSenderText}>
						Node ID: <Text style={{ fontFamily: 'monospace' }}>{item.senderId}</Text>
					</Text>

					<Text style={styles.sosMessageBody}>{parsed.message}</Text>

					<View style={styles.coordsGrid}>
						<View style={styles.coordCol}>
							<Text style={styles.coordLabel}>LATITUDE</Text>
							<Text style={styles.coordValue}>{parsed.coords.lat}</Text>
						</View>
						<View style={styles.coordCol}>
							<Text style={styles.coordLabel}>LONGITUDE</Text>
							<Text style={styles.coordValue}>{parsed.coords.lng}</Text>
						</View>
					</View>

					<View style={[styles.coordsGrid, { marginTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(239,68,68,0.1)', paddingTop: 6 }]}>
						<View style={styles.coordCol}>
							<Text style={styles.coordLabel}>ALTITUDE</Text>
							<Text style={styles.coordValue}>{parsed.coords.alt}</Text>
						</View>
						<View style={styles.coordCol}>
							<Text style={styles.coordLabel}>ACCURACY</Text>
							<Text style={styles.coordValue}>{parsed.coords.acc}</Text>
						</View>
					</View>

					<View style={styles.sosCardFooter}>
						<Text style={styles.sosTimeText}>{format(item.timestamp, 'PP pp')}</Text>
						<Text style={styles.sosStatusText}>{item.status.toUpperCase()}</Text>
					</View>
				</View>
			);
		}

		// Render Premium Regular Chat Message Bubble (Left/Right Layout)
		return (
			<View style={[styles.messageRow, isMe ? styles.messageRowRight : styles.messageRowLeft]}>
				{!isMe && <Text style={styles.peerIdLabel}>{item.senderId.slice(0, 10)}</Text>}
				<View style={[styles.messageBubble, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
					<Text style={styles.messageText}>{item.text}</Text>
					<View style={styles.messageMeta}>
						<Text style={styles.metaTimeText}>{format(item.timestamp, 'p')}</Text>
						{isMe && <Text style={styles.metaStatusText}>{item.status}</Text>}
					</View>
				</View>
			</View>
		);
	};

	return (
		<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
			<FlatList
				data={messages}
				keyExtractor={(item) => item.id}
				renderItem={renderItem}
				contentContainerStyle={styles.listContainer}
				inverted
			/>
			<View style={styles.inputBar}>
				<TouchableOpacity
					onPress={sendSOS}
					disabled={isLocating}
					style={[styles.sosButton, isLocating && { opacity: 0.5 }]}
				>
					<Text style={styles.sosButtonText}>{isLocating ? '...' : '🆘 SOS'}</Text>
				</TouchableOpacity>
				<TextInput
					ref={inputRef}
					value={input}
					onChangeText={(t) => setInput(t.slice(0, 200))}
					placeholder={isLocating ? 'Fetching GPS coordinates...' : 'Type offline message...'}
					placeholderTextColor="#71717a"
					style={styles.textInput}
					editable={!isLocating}
				/>
				<TouchableOpacity
					onPress={send}
					disabled={isLocating || !input.trim()}
					style={[
						styles.sendButton,
						(!input.trim() || isLocating) && styles.sendButtonDisabled
					]}
				>
					<Text style={styles.sendButtonText}>Send</Text>
				</TouchableOpacity>
			</View>
		</KeyboardAvoidingView>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#09090b',
	},
	listContainer: {
		paddingHorizontal: 16,
		paddingTop: 16,
		paddingBottom: 90,
	},
	messageRow: {
		flexDirection: 'column',
		marginVertical: 6,
		maxWidth: '75%',
	},
	messageRowLeft: {
		alignSelf: 'flex-start',
	},
	messageRowRight: {
		alignSelf: 'flex-end',
		alignItems: 'flex-end',
	},
	peerIdLabel: {
		color: '#71717a',
		fontSize: 11,
		marginBottom: 3,
		marginLeft: 4,
		fontFamily: 'monospace',
	},
	messageBubble: {
		borderRadius: 16,
		paddingHorizontal: 14,
		paddingVertical: 10,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.15,
		shadowRadius: 2,
		elevation: 1,
	},
	bubbleLeft: {
		backgroundColor: '#18181b',
		borderWidth: 1,
		borderColor: '#27272a',
		borderBottomLeftRadius: 4,
	},
	bubbleRight: {
		backgroundColor: '#1d4ed8',
		borderBottomRightRadius: 4,
	},
	messageText: {
		color: '#f4f4f5',
		fontSize: 14,
		lineHeight: 20,
	},
	messageMeta: {
		flexDirection: 'row',
		justifyContent: 'flex-end',
		alignItems: 'center',
		marginTop: 4,
	},
	metaTimeText: {
		color: '#a1a1aa',
		fontSize: 10,
		marginRight: 4,
	},
	metaStatusText: {
		color: '#93c5fd',
		fontSize: 10,
		fontWeight: '500',
	},
	// SOS Distress Card Styles
	sosCard: {
		backgroundColor: '#1c0809',
		borderColor: '#ef4444',
		borderWidth: 1.5,
		borderRadius: 14,
		padding: 14,
		marginVertical: 10,
		shadowColor: '#ef4444',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.2,
		shadowRadius: 6,
		elevation: 3,
	},
	sosHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		borderBottomWidth: 1,
		borderBottomColor: 'rgba(239,68,68,0.25)',
		paddingBottom: 8,
		marginBottom: 8,
	},
	pulsingDot: {
		width: 10,
		height: 10,
		borderRadius: 5,
		marginRight: 8,
	},
	sosBadgeText: {
		color: '#ef4444',
		fontWeight: '800',
		fontSize: 12,
		letterSpacing: 0.8,
	},
	sosHopsText: {
		color: '#a1a1aa',
		fontSize: 10,
	},
	sosSenderText: {
		color: '#a1a1aa',
		fontSize: 11,
		marginBottom: 6,
	},
	sosMessageBody: {
		color: '#ffffff',
		fontSize: 15,
		fontWeight: '600',
		lineHeight: 22,
		marginVertical: 8,
	},
	coordsGrid: {
		flexDirection: 'row',
		backgroundColor: 'rgba(0,0,0,0.3)',
		borderRadius: 8,
		paddingVertical: 6,
		paddingHorizontal: 8,
	},
	coordCol: {
		flex: 1,
	},
	coordLabel: {
		color: '#ef4444',
		fontSize: 8,
		fontWeight: '700',
		letterSpacing: 0.5,
		marginBottom: 2,
	},
	coordValue: {
		color: '#f4f4f5',
		fontSize: 13,
		fontFamily: 'monospace',
		fontWeight: '600',
	},
	sosCardFooter: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginTop: 8,
		paddingTop: 6,
	},
	sosTimeText: {
		color: '#71717a',
		fontSize: 10,
	},
	sosStatusText: {
		color: '#fca5a5',
		fontSize: 10,
		fontWeight: '700',
	},
	// Input Bar Styles
	inputBar: {
		position: 'absolute',
		left: 0,
		right: 0,
		bottom: 0,
		flexDirection: 'row',
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderTopColor: '#27272a',
		borderTopWidth: 1,
		backgroundColor: '#09090b',
		alignItems: 'center',
	},
	sosButton: {
		backgroundColor: '#7f1d1d',
		borderColor: '#ef4444',
		borderWidth: 1,
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: 10,
		marginRight: 8,
		justifyContent: 'center',
		alignItems: 'center',
	},
	sosButtonText: {
		color: '#fff',
		fontWeight: '800',
		fontSize: 13,
	},
	textInput: {
		flex: 1,
		borderColor: '#27272a',
		backgroundColor: '#18181b',
		borderWidth: 1,
		borderRadius: 10,
		paddingHorizontal: 12,
		paddingVertical: 8,
		color: '#fafafa',
		fontSize: 14,
	},
	sendButton: {
		marginLeft: 8,
		backgroundColor: '#1d4ed8',
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 10,
		justifyContent: 'center',
		alignItems: 'center',
	},
	sendButtonDisabled: {
		backgroundColor: '#27272a',
		opacity: 0.5,
	},
	sendButtonText: {
		color: '#fff',
		fontWeight: '600',
		fontSize: 14,
	},
});
