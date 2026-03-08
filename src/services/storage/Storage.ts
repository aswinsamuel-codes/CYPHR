import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatMessage } from '@/components/ChatScreen';

const MESSAGES_KEY = 'cyphr/messages';
const DEVICE_KEY_STORAGE = 'cyphr/device-key';

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

export const Storage = {
	async getAllMessages(): Promise<ChatMessage[]> {
		return loadAll();
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


