/**
 * MYRA car app: the MYRA UI (bundled from ../web, loaded from the APK's assets) in a full-screen WebView, plus the
 * on-device model. The UI sends {id, type: 'understand', text}; the answer goes back via window.__myraNative.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { loadGemma, understand } from './src/gemma';

const UI = 'file:///android_asset/web/index.html';

export default function App() {
  // Explicit generic: the package types default P to undefined, which TS turns into never props.
  const web = useRef<WebView<object>>(null);
  const [modelStatus, setModelStatus] = useState('');

  useEffect(() => {
    void PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]);
    loadGemma(setModelStatus).catch(() => undefined); // retried on the first command
  }, []);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: { id?: unknown; type?: unknown; text?: unknown };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type !== 'understand' || typeof msg.id !== 'number' || typeof msg.text !== 'string') return;
    let payload: object;
    try {
      payload = await understand(msg.text, setModelStatus);
    } catch (err) {
      payload = { error: err instanceof Error ? err.message : String(err) };
    }
    web.current?.injectJavaScript(`window.__myraNative && window.__myraNative(${msg.id}, ${JSON.stringify(payload)}); true;`);
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <WebView<object>
        ref={web}
        source={{ uri: UI }}
        style={styles.root}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        onMessage={onMessage}
      />
      {modelStatus ? <Text style={styles.badge}>{modelStatus}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05080d' },
  badge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(5,8,13,0.8)',
    color: '#9fb3c8',
    fontSize: 12,
  },
});
