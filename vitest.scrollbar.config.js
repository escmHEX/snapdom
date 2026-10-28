import config from './vitest.snapshot-native.config.js'
config.test.include = ['__tests__/scrollbar-fidelity.test.js']
config.test.browser.instances = config.test.browser.instances.map(instance => ({
  ...instance, launch: { ignoreDefaultArgs: ['--hide-scrollbars'] }
}))
config.test.browser.commands.normalizeScrollbarFrame = async ({ frame }) => {
  // Normalize only Vitest's presentation wrapper, not the tested document.
  // Its fit-to-window transform otherwise scales the reference screenshot.
  const element = await (await frame()).frameElement()
  return element.evaluate(el => {
    const before = el.parentElement.style.cssText
    el.parentElement.style.setProperty('transform', 'none', 'important')
    return before
  })
}
config.test.browser.commands.restoreScrollbarFrame = async ({ frame }, style) => {
  const element = await (await frame()).frameElement()
  await element.evaluate((el, before) => { el.parentElement.style.cssText = before }, style)
}
config.test.browser.commands.nativeScrollbarImage = async ({ frame }) => {
  const bytes = await (await frame()).locator('[data-scrollbar-fixture]').screenshot({ scale: 'css' })
  return bytes.toString('base64')
}
export default config
