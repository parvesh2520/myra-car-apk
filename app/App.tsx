/**
 * MYRA car app: the MYRA UI (bundled from ../web, loaded from the APK's assets) in a full-screen WebView, plus the
 * on-device model. The UI sends {id, type: 'understand', text}; the answer goes back via window.__myraNative.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { downloadEnabled, loadGemma, modelInstalled, setDownloadEnabled, understand } from './src/gemma';
import MyraSystem from './modules/myra-system';

const UI = 'file:///android_asset/web/index.html';
const FREE_MEMORY_EVERY_MS = 60000;

export default function App() {
  // Explicit generic: the package types default P to undefined, which TS turns into never props.
  const web = useRef<WebView<object>>(null);
  const [modelStatus, setModelStatus] = useState('');
  const [memNote, setMemNote] = useState('');
  const [download, setDownload] = useState(downloadEnabled);

  useEffect(() => {
    void PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]);
    // Low-end head unit (1 GB RAM): end other apps' background processes before the model loads, whenever MYRA
    // comes back to the screen, and every minute while it runs, so apps that restart do not keep their RAM.
    const freeMemory = async () => {
      const mem = await MyraSystem?.freeMemory().catch(() => null);
      if (mem) setMemNote(` · ${mem.afterMb} MB free`);
    };
    void freeMemory().then(() => loadGemma(setModelStatus).catch(() => undefined)); // retried on the first command
    const timer = setInterval(() => void freeMemory(), FREE_MEMORY_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void freeMemory());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  // Tapping the badge switches the cloud download off (pauses it) or on (starts or resumes it).
  const toggleDownload = useCallback(() => {
    if (modelInstalled()) return;
    void setDownloadEnabled(!download, setModelStatus).then(setDownload);
  }, [download]);

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
        cacheEnabled={false}
        // Android ends the WebView's renderer when RAM runs out (the screen turns white): load the UI again.
        onRenderProcessGone={() => web.current?.reload()}
        mediaCapturePermissionGrantType="grant"
        onMessage={onMessage}
      />
      {modelStatus ? (
        <Pressable onPress={toggleDownload} style={styles.badge} accessibilityRole="button"
          accessibilityLabel={`${modelStatus}. Model download ${download ? 'on' : 'off'}.`}>
          <Text style={styles.badgeText}>{modelStatus}{memNote}</Text>
        </Pressable>
      ) : null}
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
  },
  badgeText: { color: '#9fb3c8', fontSize: 12 },
});
