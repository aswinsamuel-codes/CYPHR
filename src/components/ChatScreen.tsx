import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { MeshManager } from '@/services/mesh/MeshManager';
import { Storage } from '@/services/storage/Storage';
import { format } from 'date-fns';

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

export const ChatScreen: React.FC<Props> = ({ meshManager, storage }) => {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState('');
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

	const renderItem = ({ item }: { item: ChatMessage }) => {
		return (
			<View style={{ paddingVertical: 8, paddingHorizontal: 12, borderBottomColor: '#eee', borderBottomWidth: 1 }}>
				<Text style={{ fontWeight: '600' }}>{item.senderId} → {item.recipientId}</Text>
				<Text style={{ marginTop: 4 }}>{item.text}</Text>
				<View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
					<Text style={{ color: '#666', fontSize: 12 }}>{format(item.timestamp, 'PP pp')}</Text>
					<Text style={{ color: '#666', fontSize: 12 }}>{item.status}</Text>
				</View>
			</View>
		);
	};

	return (
		<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
			<FlatList
				data={messages}
				keyExtractor={(item) => item.id}
				renderItem={renderItem}
				contentContainerStyle={{ paddingBottom: 80 }}
				inverted
			/>
			<View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', padding: 8, borderTopColor: '#eee', borderTopWidth: 1, backgroundColor: '#fff' }}>
				<TextInput
					ref={inputRef}
					value={input}
					onChangeText={(t) => setInput(t.slice(0, 200))}
					placeholder="Type message (max 200 chars)"
					style={{ flex: 1, borderColor: '#ddd', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
				/>
				<TouchableOpacity onPress={send} style={{ marginLeft: 8, backgroundColor: '#0a84ff', paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center' }}>
					<Text style={{ color: '#fff', fontWeight: '600' }}>Send</Text>
				</TouchableOpacity>
			</View>
		</KeyboardAvoidingView>
	);
};


