import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // Keep runtime dependencies (the Agent SDK) external rather than bundled:
    // the SDK is ESM only and spawns the Claude Code CLI, so it must be loaded
    // from node_modules at runtime, not inlined.
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      // A single self-contained entry. Sandboxed preloads cannot require a
      // sibling chunk at runtime, and multiple entries that share a module make
      // the bundler emit one. index.ts installs the right bridge per window.
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    // transformers.js pulls in onnxruntime-web; let it load as-is rather than
    // being pre-bundled, and load its model and wasm lazily at runtime.
    optimizeDeps: { exclude: ['@huggingface/transformers'] },
    worker: { format: 'es' },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          orb: resolve(__dirname, 'src/renderer/orb/index.html'),
          chat: resolve(__dirname, 'src/renderer/chat/index.html'),
          snip: resolve(__dirname, 'src/renderer/snip/index.html')
        }
      }
    }
  }
})
