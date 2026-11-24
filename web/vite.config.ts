import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:phone` serves over HTTPS on the local network: phones/tablets only expose
// motion sensors (MotionSense), camera and microphone to secure origins.
export default defineConfig(({ mode }) => {
  const phone = mode === 'phone';
  // `npm run build:car` builds the UI for the car app: relative paths (loaded from file:///android_asset/web/)
  // into ../app/web-dist, which the app's config plugin copies into the APK. Backend URL: .env.car.
  const car = mode === 'car';
  return {
    base: car ? './' : '/',
    build: car ? { outDir: '../app/web-dist', emptyOutDir: true } : undefined,
    plugins: [react(), tailwindcss(), ...(phone ? [basicSsl()] : [])],
    // Development: /api goes to the FastAPI backend (uvicorn on :8000). Set VITE_API_URL to call another host directly.
    server: { port: 5173, host: phone || undefined, proxy: { '/api': 'http://127.0.0.1:8000' } },
  };
});
