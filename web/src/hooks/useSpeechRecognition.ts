import { useCallback, useEffect, useRef, useState } from 'react';
import { getRecognitionCtor, recognitionErrorMessage, type Recognition } from '../services/speech';

/**
 * Microphone access is only requested by the browser when `start` is called,
 * which always happens in response to an explicit tap on the mic button.
 */
export function useSpeechRecognition(lang: string) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const supported = getRecognitionCtor() !== null;

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(
    (onFinal: (text: string) => void) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        setError('Voice input isn’t supported in this browser. Type your request instead.');
        return;
      }
      recRef.current?.abort();
      const rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = '';
      let delivered = false;

      rec.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          text += r[0].transcript;
          if (r.isFinal) finalText = text;
        }
        setInterim(text);
      };
      rec.onerror = (e) => {
        const msg = recognitionErrorMessage(e.error);
        if (msg) setError(msg);
      };
      rec.onend = () => {
        setListening(false);
        recRef.current = null;
        if (!delivered && finalText.trim()) {
          delivered = true;
          onFinal(finalText.trim());
        }
      };

      setError(null);
      setInterim('');
      try {
        rec.start();
        recRef.current = rec;
        setListening(true);
      } catch {
        setError('Couldn’t start the microphone. Please try again.');
      }
    },
    [lang],
  );

  useEffect(() => () => recRef.current?.abort(), []);
  const clearError = useCallback(() => setError(null), []);

  return { supported, listening, interim, error, start, stop, clearError };
}
