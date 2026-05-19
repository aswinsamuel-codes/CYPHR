import 'react-native-get-random-values';

import React, { useEffect } from 'react';
import { SafeAreaView, StatusBar } from 'react-native';
import { ChatScreen } from './components/ChatScreen';
import { DeviceInfoHeader } from './components/DeviceInfoHeader';
import { MeshManager } from './services/mesh/MeshManager';
import { Storage } from './services/storage/Storage';

const meshManager = new MeshManager(Storage);

export default function App() {
	useEffect(() => {
		console.log('[CYPHR] App mounted — initializing MeshManager');
		meshManager.start();
		return () => meshManager.stop();
	}, []);

	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: '#09090b' }}>
			<StatusBar barStyle="light-content" backgroundColor="#09090b" />
			<DeviceInfoHeader meshManager={meshManager} />
			<ChatScreen meshManager={meshManager} storage={Storage} />
		</SafeAreaView>
	);
}
