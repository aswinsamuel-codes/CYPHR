import React, { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View, Alert, StyleSheet, ScrollView } from 'react-native';
import type { MeshManager } from '@/services/mesh/MeshManager';
import { Storage } from '@/services/storage/Storage';
import { format } from 'date-fns';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import { cacheDirectory, EncodingType, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Battery from 'expo-battery';

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
		battery: string | null;
	} | null;
	message: string;
}

interface VoiceDetails {
	isVoice: boolean;
	duration: number;
	audioBase64: string | null;
}

const CHANNELS = [
	{ id: 'general', name: 'GENERAL', color: '#3b82f6' }, // Blue
	{ id: 'rescue', name: 'RESCUE', color: '#ef4444' },   // Red
	{ id: 'medical', name: 'MEDICAL', color: '#10b981' }, // Green
	{ id: 'supplies', name: 'SUPPLIES', color: '#f59e0b' }, // Amber
] as const;

type ChannelId = typeof CHANNELS[number]['id'];

// Waveform visualizer heights for premium aesthetics
const WAVE_BARS = [6, 12, 18, 10, 8, 14, 22, 16, 8, 12, 18, 14, 10, 16, 12, 6, 10, 8, 4];

// Parses the structured SOS Beacon text format safely
const parseSOSMessage = (text: string): SOSDetails => {
	const isSos = text.startsWith('🚨 [SOS BEACON] 🚨');
	if (!isSos) return { isSos: false, coords: null, message: text };

	const lines = text.split('\n');
	let lat = '';
	let lng = '';
	let alt = '';
	let acc = '';
	let battery: string | null = null;
	let message = '';

	for (const line of lines) {
		if (line.startsWith('Lat:')) {
			const parts = line.replace('Lat:', '').split(', Lng:');
			lat = parts[0]?.trim() || '';
			lng = parts[1]?.trim() || '';
		} else if (line.startsWith('Alt:')) {
			// e.g. Alt: 12m | Acc: ±5m | Battery: 12%
			const parts = line.replace('Alt:', '').split('|');
			for (const part of parts) {
				const p = part.trim();
				if (p.startsWith('Acc:')) {
					acc = p.replace('Acc:', '').trim();
				} else if (p.startsWith('Battery:')) {
					battery = p.replace('Battery:', '').trim();
				} else if (!p.startsWith('Acc:') && !p.startsWith('Battery:')) {
					alt = p;
				}
			}
		} else if (line.startsWith('Message:')) {
			message = line.replace('Message:', '').trim();
		}
	}

	return {
		isSos: true,
		coords: { lat, lng, alt, acc, battery },
		message: message || 'Emergency distress signal broadcasted!'
	};
};

// Parses voice message envelopes
const parseVoiceMessage = (text: string): VoiceDetails => {
	const isVoice = text.startsWith('🎵 [VOICE MESSAGE] 🚨');
	if (!isVoice) return { isVoice: false, duration: 0, audioBase64: null };

	const lines = text.split('\n');
	let duration = 0;
	let audioBase64 = '';

	for (const line of lines) {
		if (line.startsWith('Duration:')) {
			duration = parseInt(line.replace('Duration:', '').trim(), 10) || 0;
		} else if (line.startsWith('Audio:')) {
			audioBase64 = line.replace('Audio:', '').trim();
		}
	}

	return { isVoice: true, duration, audioBase64: audioBase64 || null };
};

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
	const [activeChannel, setActiveChannel] = useState<ChannelId>('general');
	
	// Battery & Power Guard states
	const [batteryLevel, setBatteryLevel] = useState<number>(1.0);
	const [powerGuardOverride, setPowerGuardOverride] = useState<boolean>(false);

	// Voice recording states
	const [recording, setRecording] = useState<Audio.Recording | null>(null);
	const [isRecording, setIsRecording] = useState(false);
	const [recordingDuration, setRecordingDuration] = useState(0);
	const [currentlyPlayingMsgId, setCurrentlyPlayingMsgId] = useState<string | null>(null);
	
	const inputRef = useRef<TextInput | null>(null);
	const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
	const activeSoundRef = useRef<Audio.Sound | null>(null);

	// Derives whether the Power Guard (low power mode) is active
	const powerGuardActive = batteryLevel <= 0.2 || powerGuardOverride;

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
			if (activeSoundRef.current) {
				activeSoundRef.current.unloadAsync().catch(() => {});
			}
			if (recordingTimerRef.current) {
				clearInterval(recordingTimerRef.current);
			}
		};
	}, [meshManager, storage]);

	// Wire Battery Status Listeners
	useEffect(() => {
		let isMounted = true;
		
		const getBattery = async () => {
			try {
				const lvl = await Battery.getBatteryLevelAsync();
				if (isMounted) setBatteryLevel(lvl >= 0 ? lvl : 1.0);
			} catch (e) {
				console.log('Failed to fetch initial battery level:', e);
			}
		};
		getBattery();

		const subscription = Battery.addBatteryLevelListener(({ batteryLevel: newLvl }) => {
			if (isMounted) setBatteryLevel(newLvl >= 0 ? newLvl : 1.0);
		});

		return () => {
			isMounted = false;
			subscription.remove();
		};
	}, []);

	// Proxy Low Power Mode duty cycles to MeshManager
	useEffect(() => {
		meshManager.setLowPowerMode(powerGuardActive);
	}, [powerGuardActive, meshManager]);

	const send = async () => {
		const text = input.trim();
		if (!text) return;
		setInput('');

		// Append battery suffix if Power Guard is active
		const batteryPercent = Math.round(batteryLevel * 100);
		const suffix = powerGuardActive ? ` [Battery: ${batteryPercent}%]` : '';
		const finalPayload = `${text}${suffix}`;

		const msg = await meshManager.sendText(finalPayload, `channel-${activeChannel}`);
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

							const batteryPercent = Math.round(batteryLevel * 100);
							const suffix = powerGuardActive ? ` | Battery: ${batteryPercent}%` : '';

							const customMsg = input.trim();
							const sosText = customMsg || 'Distress signal broadcasted — emergency assistance needed!';
							const formattedText = `🚨 [SOS BEACON] 🚨\nLat: ${lat}, Lng: ${lng}\nAlt: ${alt}m | Acc: ±${acc}m${suffix}\nMessage: ${sosText}`;

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

	// ── Recording Helpers ─────────────────────────────────────────────

	const startRecording = async () => {
		if (powerGuardActive) {
			Alert.alert('Power Guard Active', 'Voice notes are disabled in Power Guard mode to conserve critical battery charge.');
			return;
		}

		try {
			const permission = await Audio.requestPermissionsAsync();
			if (permission.status !== 'granted') {
				Alert.alert('Microphone Denied', 'Microphone recording permissions are required to share voice notes offline.');
				return;
			}

			await Audio.setAudioModeAsync({
				allowsRecordingIOS: true,
				playsInSilentModeIOS: true,
			});

			const { recording: newRecording } = await Audio.Recording.createAsync({
				android: {
					extension: '.m4a',
					outputFormat: Audio.AndroidOutputFormat.MPEG_4,
					audioEncoder: Audio.AndroidAudioEncoder.AAC,
					sampleRate: 8000,
					numberOfChannels: 1,
					bitRate: 12200,
				},
				ios: {
					extension: '.m4a',
					audioQuality: Audio.IOSAudioQuality.MIN,
					sampleRate: 8000,
					numberOfChannels: 1,
					bitRate: 12200,
					linearPCMBitDepth: 16,
					linearPCMIsBigEndian: false,
					linearPCMIsFloat: false,
				},
				web: {}
			});

			setRecording(newRecording);
			setIsRecording(true);
			setRecordingDuration(0);

			recordingTimerRef.current = setInterval(() => {
				setRecordingDuration((prev) => {
					if (prev >= 9) {
						clearInterval(recordingTimerRef.current!);
						recordingTimerRef.current = null;
						// Trigger stop recording asynchronously
						stopRecording(newRecording, 10);
						return 10;
					}
					return prev + 1;
				});
			}, 1000);
		} catch (err: any) {
			Alert.alert('Recording Failure', 'Could not start recording session: ' + err.message);
		}
	};

	const cancelRecording = async () => {
		if (recordingTimerRef.current) {
			clearInterval(recordingTimerRef.current);
			recordingTimerRef.current = null;
		}
		if (recording) {
			try {
				await recording.stopAndUnloadAsync();
			} catch {}
			setRecording(null);
		}
		setIsRecording(false);
	};

	const stopRecording = async (activeRecording?: Audio.Recording | null, forcedDuration?: number) => {
		const recToStop = activeRecording !== undefined ? activeRecording : recording;
		if (recordingTimerRef.current) {
			clearInterval(recordingTimerRef.current);
			recordingTimerRef.current = null;
		}
		if (!recToStop) {
			setIsRecording(false);
			return;
		}

		setIsRecording(false);
		setRecording(null);

		try {
			await recToStop.stopAndUnloadAsync();
			await Audio.setAudioModeAsync({
				allowsRecordingIOS: false,
				playsInSilentModeIOS: true,
			});

			const uri = recToStop.getURI();
			if (!uri) throw new Error('Recording URI is invalid.');

			const duration = forcedDuration || recordingDuration || 1;
			const base64Data = await readAsStringAsync(uri, {
				encoding: EncodingType.Base64,
			});

			const formattedText = `🎵 [VOICE MESSAGE] 🚨\nDuration: ${duration}\nAudio: ${base64Data}`;
			
			const msg = await meshManager.sendText(formattedText, `channel-${activeChannel}`);
			await storage.saveMessage(msg);
			setMessages((prev) => [msg, ...prev]);
		} catch (err: any) {
			Alert.alert('Save Failure', 'Failed to compile or transmit audio message: ' + err.message);
		}
	};

	// ── Playback Helpers ──────────────────────────────────────────────

	const playVoice = async (msgId: string, base64Data: string) => {
		try {
			if (activeSoundRef.current) {
				await activeSoundRef.current.stopAsync();
				await activeSoundRef.current.unloadAsync();
				activeSoundRef.current = null;
			}

			// Toggling play/stop
			if (currentlyPlayingMsgId === msgId) {
				setCurrentlyPlayingMsgId(null);
				return;
			}

			setCurrentlyPlayingMsgId(msgId);

			const tempUri = `${cacheDirectory}voice_${msgId}.m4a`;
			await writeAsStringAsync(tempUri, base64Data, {
				encoding: EncodingType.Base64,
			});

			const { sound } = await Audio.Sound.createAsync(
				{ uri: tempUri },
				{ shouldPlay: true }
			);

			activeSoundRef.current = sound;

			sound.setOnPlaybackStatusUpdate((status) => {
				if (status.isLoaded && status.didJustFinish) {
					sound.unloadAsync().catch(() => {});
					activeSoundRef.current = null;
					setCurrentlyPlayingMsgId(null);
				}
			});
		} catch (err: any) {
			Alert.alert('Playback Error', 'Failed to play audio note: ' + err.message);
			setCurrentlyPlayingMsgId(null);
		}
	};

	// Filters messages according to channel selection, bypassing for SOS Beacons
	const filteredMessages = messages.filter((msg) => {
		const parsedSOS = parseSOSMessage(msg.text);
		if (parsedSOS.isSos) return true; // Safety override

		// Show private direct messages
		if (msg.recipientId === deviceId) return true;

		// Match active channel ID
		if (msg.recipientId === `channel-${activeChannel}`) return true;

		// Support backwards compatibility for legacy general broadcasts
		if (activeChannel === 'general' && msg.recipientId === 'broadcast') return true;

		return false;
	});

	const renderItem = ({ item }: { item: ChatMessage }) => {
		const isMe = item.senderId === deviceId;
		const isPrivate = item.recipientId === deviceId;
		const parsedSOS = parseSOSMessage(item.text);
		const parsedVoice = parseVoiceMessage(item.text);

		// 1. SOS Beacon Card
		if (parsedSOS.isSos && parsedSOS.coords) {
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

					<Text style={styles.sosMessageBody}>{parsedSOS.message}</Text>

					<View style={styles.coordsGrid}>
						<View style={styles.coordCol}>
							<Text style={styles.coordLabel}>LATITUDE</Text>
							<Text style={styles.coordValue}>{parsedSOS.coords.lat}</Text>
						</View>
						<View style={styles.coordCol}>
							<Text style={styles.coordLabel}>LONGITUDE</Text>
							<Text style={styles.coordValue}>{parsedSOS.coords.lng}</Text>
						</View>
					</View>

					<View style={[styles.coordsGrid, { marginTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(239,68,68,0.1)', paddingTop: 6 }]}>
						<View style={styles.coordCol}>
							<Text style={styles.coordLabel}>ALTITUDE</Text>
							<Text style={styles.coordValue}>{parsedSOS.coords.alt}</Text>
						</View>
						<View style={styles.coordCol}>
							<Text style={styles.coordLabel}>ACCURACY</Text>
							<Text style={styles.coordValue}>{parsedSOS.coords.acc}</Text>
						</View>
					</View>

					{parsedSOS.coords.battery && (
						<View style={styles.sosBatteryContainer}>
							<Text style={styles.sosBatteryText}>🔋 Node Battery Level: {parsedSOS.coords.battery}</Text>
						</View>
					)}

					<View style={styles.sosCardFooter}>
						<Text style={styles.sosTimeText}>{format(item.timestamp, 'PP pp')}</Text>
						<Text style={styles.sosStatusText}>{item.status.toUpperCase()}</Text>
					</View>
				</View>
			);
		}

		// 2. Voice Message Card
		if (parsedVoice.isVoice && parsedVoice.audioBase64) {
			const isPlaying = currentlyPlayingMsgId === item.id;
			const cardStyle = isMe ? styles.voiceCardRight : styles.voiceCardLeft;

			return (
				<View style={[styles.voiceCard, cardStyle]}>
					<View style={styles.voiceCardHeader}>
						<Text style={styles.voiceSenderLabel}>{isMe ? 'You' : item.senderId.slice(0, 10)} • Voice Note</Text>
						{isPrivate && <Text style={styles.privateBadge}>🔒 PRIVATE</Text>}
					</View>

					<View style={styles.voicePlayerRow}>
						<TouchableOpacity
							onPress={() => playVoice(item.id, parsedVoice.audioBase64!)}
							style={[styles.playButton, isPlaying && styles.stopButtonColor]}
						>
							<Text style={styles.playButtonText}>{isPlaying ? '◼' : '▶'}</Text>
						</TouchableOpacity>

						<View style={styles.waveformContainer}>
							{WAVE_BARS.map((h, i) => (
								<View
									key={i}
									style={[
										styles.waveBar,
										{ height: h },
										isPlaying && { backgroundColor: '#38bdf8' }
									]}
								/>
							))}
						</View>

						<Text style={styles.voiceDuration}>{parsedVoice.duration}s</Text>
					</View>

					<View style={styles.voiceCardFooter}>
						<Text style={styles.voiceTimeText}>{format(item.timestamp, 'p')}</Text>
						{isMe && <Text style={styles.voiceStatusText}>{item.status}</Text>}
					</View>
				</View>
			);
		}

		const bubbleStyle = isMe ? styles.bubbleRight : styles.bubbleLeft;

		// 3. Regular Text Message Bubble
		return (
			<View style={[styles.messageRow, isMe ? styles.messageRowRight : styles.messageRowLeft]}>
				<View style={styles.messageHeaderRow}>
					{!isMe && <Text style={styles.peerIdLabel}>{item.senderId.slice(0, 10)}</Text>}
					{isPrivate && <Text style={styles.privateBadge}>🔒 PRIVATE</Text>}
				</View>
				<View style={[styles.messageBubble, bubbleStyle]}>
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
			{/* Channel Selector Bar */}
			<View style={styles.channelBarContainer}>
				<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelScroll}>
					{CHANNELS.map((ch) => {
						const isActive = activeChannel === ch.id;
						return (
							<TouchableOpacity
								key={ch.id}
								onPress={() => setActiveChannel(ch.id)}
								style={[
									styles.channelPill,
									isActive ? { borderColor: ch.color, backgroundColor: 'rgba(255, 255, 255, 0.05)' } : styles.channelPillInactive
								]}
							>
								<View style={[styles.channelDot, { backgroundColor: ch.color }]} />
								<Text style={[styles.channelText, isActive ? styles.channelTextActive : styles.channelTextInactive]}>
									{ch.name}
								</Text>
							</TouchableOpacity>
						);
					})}

					{/* Interactive Battery / Power Guard Manual Toggle Pill */}
					<TouchableOpacity
						onPress={() => setPowerGuardOverride((prev) => !prev)}
						style={[
							styles.batteryPill,
							powerGuardActive ? styles.batteryPillActive : styles.batteryPillInactive
						]}
					>
						<Text style={[styles.batteryPillText, powerGuardActive && styles.batteryPillTextActive]}>
							🔋 {Math.round(batteryLevel * 100)}%{powerGuardActive ? ' (GUARD)' : ''}
						</Text>
					</TouchableOpacity>
				</ScrollView>
			</View>

			{/* Custom Battery-Saving Power Guard Warning Banner */}
			{powerGuardActive && (
				<View style={styles.powerGuardBanner}>
					<Text style={styles.powerGuardBannerText}>
						⚠️ Power Guard Active: BLE Duty Cycles throttled to conserve phone battery. Audio messages disabled.
					</Text>
				</View>
			)}

			<FlatList
				data={filteredMessages}
				keyExtractor={(item) => item.id}
				renderItem={renderItem}
				contentContainerStyle={styles.listContainer}
				inverted
			/>

			{/* Input and Recording Controls */}
			<View style={styles.inputBar}>
				{isRecording ? (
					// Full width Recording Panel
					<View style={styles.recordingPanel}>
						<View style={{ flexDirection: 'row', alignItems: 'center' }}>
							<View style={styles.recordingRedDot} />
							<Text style={styles.recordingDurationText}>
								Recording: 0:0{recordingDuration} / 0:10
							</Text>
						</View>
						<View style={{ flexDirection: 'row' }}>
							<TouchableOpacity onPress={cancelRecording} style={styles.cancelRecordingBtn}>
								<Text style={styles.cancelRecordingBtnText}>Cancel</Text>
							</TouchableOpacity>
							<TouchableOpacity onPress={() => stopRecording()} style={styles.stopRecordingBtn}>
								<Text style={styles.stopRecordingBtnText}>Send</Text>
							</TouchableOpacity>
						</View>
					</View>
				) : (
					// Standard Input Bar
					<>
						<TouchableOpacity
							onPress={sendSOS}
							disabled={isLocating}
							style={[styles.sosButton, isLocating && { opacity: 0.5 }]}
						>
							<Text style={styles.sosButtonText}>{isLocating ? '...' : '🆘 SOS'}</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={startRecording}
							disabled={isLocating || powerGuardActive}
							style={[
								styles.micButton,
								(isLocating || powerGuardActive) && { opacity: 0.3 }
							]}
						>
							<Text style={styles.micButtonText}>🎙️</Text>
						</TouchableOpacity>
						<TextInput
							ref={inputRef}
							value={input}
							onChangeText={(t) => setInput(t.slice(0, 200))}
							placeholder={isLocating ? 'Fetching GPS coordinates...' : `Message #${activeChannel}...`}
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
					</>
				)}
			</View>
		</KeyboardAvoidingView>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#09090b',
	},
	channelBarContainer: {
		backgroundColor: '#09090b',
		borderBottomWidth: 1,
		borderBottomColor: '#27272a',
		paddingVertical: 8,
	},
	channelScroll: {
		paddingHorizontal: 12,
	},
	channelPill: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 20,
		marginRight: 8,
		borderWidth: 1,
	},
	channelPillInactive: {
		backgroundColor: '#18181b',
		borderColor: '#27272a',
	},
	channelDot: {
		width: 6,
		height: 6,
		borderRadius: 3,
		marginRight: 6,
	},
	channelText: {
		fontSize: 11,
		fontWeight: '700',
		letterSpacing: 0.5,
	},
	channelTextActive: {
		color: '#fafafa',
	},
	channelTextInactive: {
		color: '#71717a',
	},
	batteryPill: {
		paddingHorizontal: 10,
		paddingVertical: 5,
		borderRadius: 20,
		borderWidth: 1,
		justifyContent: 'center',
		alignItems: 'center',
		marginRight: 16,
	},
	batteryPillInactive: {
		backgroundColor: '#18181b',
		borderColor: '#27272a',
	},
	batteryPillActive: {
		backgroundColor: 'rgba(217,119,6,0.1)',
		borderColor: '#d97706',
	},
	batteryPillText: {
		fontSize: 10,
		fontWeight: '800',
		color: '#a1a1aa',
	},
	batteryPillTextActive: {
		color: '#f59e0b',
	},
	powerGuardBanner: {
		backgroundColor: '#2d1810',
		borderBottomColor: '#d97706',
		borderBottomWidth: 1,
		paddingVertical: 6,
		paddingHorizontal: 16,
	},
	powerGuardBannerText: {
		color: '#f59e0b',
		fontSize: 10,
		fontWeight: '700',
		textAlign: 'center',
		lineHeight: 14,
	},
	listContainer: {
		paddingHorizontal: 16,
		paddingTop: 8,
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
	messageHeaderRow: {
		flexDirection: 'row',
		alignItems: 'center',
		marginBottom: 3,
	},
	peerIdLabel: {
		color: '#71717a',
		fontSize: 11,
		marginLeft: 4,
		fontFamily: 'monospace',
	},
	privateBadge: {
		color: '#f59e0b',
		fontSize: 9,
		fontWeight: '700',
		marginLeft: 6,
		backgroundColor: 'rgba(245,158,11,0.1)',
		paddingHorizontal: 4,
		paddingVertical: 1,
		borderRadius: 4,
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
	sosBatteryContainer: {
		marginTop: 8,
		backgroundColor: 'rgba(245,158,11,0.08)',
		borderColor: 'rgba(245,158,11,0.2)',
		borderWidth: 1,
		borderRadius: 6,
		paddingVertical: 4,
		paddingHorizontal: 8,
	},
	sosBatteryText: {
		color: '#f59e0b',
		fontSize: 11,
		fontWeight: '700',
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
	// Voice Message Card Styles
	voiceCard: {
		borderRadius: 16,
		paddingHorizontal: 12,
		paddingVertical: 10,
		marginVertical: 6,
		minWidth: '65%',
		maxWidth: '75%',
		borderWidth: 1,
	},
	voiceCardLeft: {
		alignSelf: 'flex-start',
		backgroundColor: '#18181b',
		borderColor: '#27272a',
	},
	voiceCardRight: {
		alignSelf: 'flex-end',
		backgroundColor: '#1e293b', // Muted slate-800 for outgoing voice
		borderColor: '#334155',
	},
	voiceCardHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 6,
	},
	voiceSenderLabel: {
		color: '#94a3b8',
		fontSize: 10,
		fontWeight: '600',
	},
	voicePlayerRow: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	playButton: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: '#3b82f6',
		justifyContent: 'center',
		alignItems: 'center',
	},
	stopButtonColor: {
		backgroundColor: '#ef4444',
	},
	playButtonText: {
		color: '#fff',
		fontSize: 14,
		fontWeight: '800',
		marginLeft: Platform.OS === 'ios' ? 2 : 1,
		marginTop: Platform.OS === 'ios' ? -1 : -2,
	},
	waveformContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		flex: 1,
		marginHorizontal: 10,
		height: 24,
	},
	waveBar: {
		width: 2.5,
		backgroundColor: '#64748b',
		borderRadius: 1.5,
		marginHorizontal: 1,
	},
	voiceDuration: {
		color: '#94a3b8',
		fontSize: 11,
		fontWeight: '600',
	},
	voiceCardFooter: {
		flexDirection: 'row',
		justifyContent: 'flex-end',
		marginTop: 6,
		alignItems: 'center',
	},
	voiceTimeText: {
		color: '#64748b',
		fontSize: 9,
		marginRight: 4,
	},
	voiceStatusText: {
		color: '#93c5fd',
		fontSize: 9,
		fontWeight: '500',
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
	micButton: {
		backgroundColor: '#27272a',
		borderColor: '#3f3f46',
		borderWidth: 1,
		paddingHorizontal: 11,
		paddingVertical: 9,
		borderRadius: 10,
		marginRight: 8,
		justifyContent: 'center',
		alignItems: 'center',
	},
	micButtonText: {
		fontSize: 14,
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
	// Recording Panel Styles
	recordingPanel: {
		flex: 1,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingHorizontal: 6,
		height: 38,
	},
	recordingRedDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: '#ef4444',
		marginRight: 8,
	},
	recordingDurationText: {
		color: '#ef4444',
		fontSize: 13,
		fontWeight: '700',
	},
	cancelRecordingBtn: {
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 8,
		marginRight: 6,
	},
	cancelRecordingBtnText: {
		color: '#71717a',
		fontSize: 13,
		fontWeight: '600',
	},
	stopRecordingBtn: {
		backgroundColor: '#ef4444',
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 8,
	},
	stopRecordingBtnText: {
		color: '#fff',
		fontSize: 13,
		fontWeight: '700',
	},
});
