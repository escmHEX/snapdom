import config from './vitest.config.js'

// A DevTools color scheme override applies to every Chromium frame and prevents
// testing the browser's normal iframe color-scheme inheritance.
config.test.browser.instances = config.test.browser.instances.map(instance => ({
  ...instance, context: { ...instance.context, colorScheme: null }
}))
export default config
