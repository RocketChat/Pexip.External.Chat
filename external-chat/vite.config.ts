/* eslint-disable @typescript-eslint/restrict-plus-operands */
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'
import { translations } from './src/translations.ts'

// The language of the strings the plugin shows, e.g. `PLUGIN_LANG=de npm run build`. Not `LANG`: that is the
// shell's locale and would pick a language nobody asked for.
const language = process.env.PLUGIN_LANG ?? 'en'
if (!(language in translations)) {
  throw new Error(`Unknown PLUGIN_LANG '${language}', expected one of: ${Object.keys(translations).join(', ')}`)
}

export default defineConfig({
  base: './',
  build: {
    target: 'esnext'
  },
  define: {
    __PLUGIN_LANG__: JSON.stringify(language)
  },
  plugins: [
    mkcert()
  ]
})
