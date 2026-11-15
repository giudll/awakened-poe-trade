/**
 * `app.userAgentFallback` carries the application name and version
 * (`awakened-poe-trade/3.30.4`). GGG's WAF denies every request whose User-Agent
 * contains that token, answering 403 with Cloudflare's "Sorry, you have been
 * blocked" page. It hits the CORS proxy *and* the built-in browser alike, so the
 * trade API is unusable and the CAPTCHA page never even renders. Both therefore
 * use this plain browser User-Agent instead.
 */
export const USER_AGENT = (() => {
  const chrome = process.versions.chrome
  switch (process.platform) {
    case 'win32':
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
    case 'darwin':
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
    default:
      return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  }
})()
