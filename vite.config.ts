import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' để chạy được ở mọi nơi: Vercel, Hostinger (kể cả trong thư mục con).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 900 },
})
