import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatMessage } from '@/components/ChatScreen';

const MESSAGES_KEY = 'cyphr/messages';
const DEVICE_KEY_STORAGE = 'cyphr/device-key';
const EXPIRY_TIME_MS = 24 * 60 * 60 * 1000; // 24 hours

async function loadAll(): Promise<ChatMessage[]> {
	const raw = await AsyncStorage.getItem(MESSAGES_KEY);
	if (!raw) return [];
	try {
		return JSON.parse(raw) as ChatMessage[];
	} catch {
		return [];
	}
}

async function saveAll(messages: ChatMessage[]): Promise<void> {
	await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

async function cleanOldMessages(messages: ChatMessage[]): Promise<ChatMessage[]> {
	const now = Date.now();
	const filtered = messages.filter((msg) => {
		const isSos = msg.text.startsWith('🚨 [SOS BEACON] 🚨');
		if (isSos) return true; // Keep critical SOS distress beacons forever
		
		const age = now - msg.timestamp;
		return age < EXPIRY_TIME_MS;
	});
	
	if (filtered.length !== messages.length) {
		await saveAll(filtered);
	}
	return filtered;
}

export const Storage = {
	async getAllMessages(): Promise<ChatMessage[]> {
		const messages = await loadAll();
		return await cleanOldMessages(messages);
	},

	async saveMessage(message: ChatMessage): Promise<void> {
		const all = await loadAll();
		await saveAll([message, ...all]);
	},

	async updateStatus(id: string, status: ChatMessage['status']): Promise<void> {
		const all = await loadAll();
		const updated = all.map((m) => (m.id === id ? { ...m, status } : m));
		await saveAll(updated);
	},

	// Device key persistence for Phase 1
	async getDeviceKey(): Promise<string | null> {
		return await AsyncStorage.getItem(DEVICE_KEY_STORAGE);
	},

	async setDeviceKey(key: string): Promise<void> {
		await AsyncStorage.setItem(DEVICE_KEY_STORAGE, key);
	},
};


