import { useState } from 'react';
import { downloadURL, release, releaseURL } from './release';
import { creatorLinks, supportURL } from './links';

const providers = [
  ['claude', 'Claude'], ['cursor', 'Cursor'], ['openai', 'ChatGPT'],
  ['gemini', 'Gemini'], ['muse', 'Muse'], ['antigravity', 'Antigravity'], ['grok-bot', 'Grok Bot'],
];

function Arrow({ down = false }: { down?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    {down ? <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 16v4h14v-4" /></> : <><path d="M5 12h14m-6-6 6 6-6 6" /></>}
  </svg>;
}

function SocialIcon({ kind }: { kind: 'github' | 'linkedin' }) {
  return <svg className="social-icon" width="16" height="16" viewBox={kind === 'github' ? '0 0 16 16' : '0 0 24 24'} fill="currentColor" aria-hidden="true">
    {kind === 'github' ? <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.49c-2.23.48-2.7-1.08-2.7-1.08-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.22.82 1.22.82.71 1.21 1.87.86 2.33.66.07-.52.28-.86.51-1.06-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.68 7.68 0 0 1 8 3.73c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /> : <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z" />}
  </svg>;
}

function DownloadButtons() {
  return <div className="downloads">
    <a className="button button-primary" href={downloadURL('arm64')} target="_blank" rel="noopener noreferrer"><Arrow down /> Download for Apple Silicon</a>
    <a className="button button-secondary" href={downloadURL('x64')} target="_blank" rel="noopener noreferrer">Intel Mac <Arrow down /></a>
  </div>;
}

function SupportLink({ className = '', label = 'Support the project' }: { className?: string; label?: string }) {
  return <a className={`support-link ${className}`} href={supportURL} target="_blank" rel="noopener noreferrer">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>
    {label}<span className="sr-only"> (opens Stripe in a new tab)</span>
  </a>;
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header page-width flex items-center justify-between">
      <a href="#" className="brand"><img src="/images/icon.png" width="32" height="32" alt="" />TokenTracking</a>
      <nav aria-label="Main navigation" className="flex items-center gap-7">
        <a className="nav-link" href="#features">Features</a>
        <a className="nav-link nav-social" href={release.repository} target="_blank" rel="noopener noreferrer"><SocialIcon kind="github" /><span className="social-label">GitHub</span></a>
        {creatorLinks.filter(({ icon }) => icon === 'linkedin').map(({ href }) => <a key={href} className="nav-link nav-social" href={href} target="_blank" rel="noopener noreferrer"><SocialIcon kind="linkedin" /><span className="social-label">LinkedIn</span></a>)}
        <SupportLink className="nav-support" label="Donate" />
      </nav>
    </header>
    <main id="main">
      <section id="download" className="hero page-width">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot" /> A small Mac app for a big AI habit</div>
          <h1>A little clarity<br />for your <span>AI limits.</span></h1>
          <p className="hero-description">All your subscription limits, together in your menu bar. Know what’s left, how fast you’re using it, and when it resets.</p>
          <div className="hero-actions"><DownloadButtons /><SupportLink className="hero-support" label="Donate" /></div>
          <p className="download-caption">Free & open source <span>·</span> macOS {release.minimumMacOS}+ <span>·</span> Chrome required</p>
          <a className="preview-link" href="#install">Preview {release.version} · installation notes <span aria-hidden="true">↗</span></a>
          <a className="hero-release-link" href={releaseURL} target="_blank" rel="noopener noreferrer">Release notes & checksums ↗</a>
        </div>
        <div className="hero-product" aria-label="TokenTracking product screenshots with demo data">
          <div className="desktop-orb orb-one" /><div className="desktop-orb orb-two" />
          <div className="menu-strip"><span className="menu-apple" aria-hidden="true">●</span><span className="menu-app">TokenTracking</span><div className="menu-crop"><img src="/images/menubar.png" alt="Menu bar with provider icons and percentage usage" /></div></div>
          <div className="hero-panel"><img src="/images/panel-dark.png" width="800" height="1122" alt="Native Mac panel with upcoming resets and usage meters" /></div>
          <div className="floating-note"><span className="note-icon" aria-hidden="true">↻</span><div><strong>Less guessing. Better pacing.</strong><span>A glance is all it takes.</span></div></div>
          <span className="image-caption">Preview build · demo data</span>
        </div>
      </section>

      <section className="provider-section page-width" aria-label="Supported services">
        <p>Your subscriptions. One place.</p>
        <div className="providers">{providers.map(([id, name]) => <div className="provider" key={id}><img src={`/providers/${id}.svg`} width="24" height="24" alt="" /><span>{name}</span></div>)}</div>
        <p className="provider-footnote">Grok Bot is tracked through Cursor. Antigravity is tracked while its desktop app is running. <a href={`${release.repository}/blob/main/docs/PROVIDERS.md`} target="_blank" rel="noopener noreferrer">Provider status ↗</a></p>
      </section>

      <section id="features" className="features-section page-width">
        <div className="section-intro"><div><p className="eyebrow">A little more headroom</p><h2>Know where you stand.<br />Before you hit a wall.</h2></div><p>Five-hour sessions. Weekly limits. Monthly pools. See the whole picture without opening every usage page.</p></div>
        <div className="feature-grid">
          <article className="feature-card"><span className="feature-number">01 / AT A GLANCE</span><h3>A home in your menu bar.</h3><p>Your chosen services at a glance. Open the panel for usage, pacing, and upcoming resets.</p><div className="meter-demo" aria-label="Illustrative weekly limit: 72 percent used"><div><span>Weekly limit</span><strong>72<span>%</span></strong></div><div className="meter-track"><span /><i title="Even pace marker" /></div><p><span className="tiny-dot" /> Ahead of pace <span>↻ 2d 4h</span></p></div></article>
          <article className="feature-card"><span className="feature-number">02 / AHEAD OF THE RESET</span><h3>Make what’s left last.</h3><p>Even-pace markers, burn rate, and reset countdowns help you decide when to switch tools or slow down.</p><div className="reset-demo"><span>Resets next</span><div><img src="/providers/openai.svg" alt="" /><strong>ChatGPT</strong><span>in 3h 12m</span></div><div><img src="/providers/claude.svg" alt="" /><strong>Claude</strong><span>in 2d 4h</span></div><small>Illustrative values</small></div></article>
          <article className="feature-card"><span className="feature-number">03 / QUIET BY DESIGN</span><h3>Up to date, quietly.</h3><p>Refreshes run invisibly in the background, every 15 minutes by default. Stale data and expired logins are clearly marked.</p><div className="quiet-demo"><div className="refresh-ring" aria-hidden="true">↻</div><span>Refresh. Read. Close.</span><small>No browser windows during refresh.</small></div></article>
        </div>
      </section>

      <section className="dashboard-section page-width">
        <div className="section-intro"><div><p className="eyebrow">When a glance isn’t enough</p><h2>The details, on your terms.</h2></div><div className="theme-switch" role="group" aria-label="Dashboard screenshot appearance">{(['dark', 'light'] as const).map((value) => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === 'dark' ? 'Dark' : 'Light'}</button>)}</div></div>
        <p className="section-description">Open the local dashboard for usage history, pace projections, and a clearer view of every pool.</p>
        <a className="dashboard-frame" href={`/images/dashboard-${theme}.png`} target="_blank" rel="noopener noreferrer" aria-label={`Open full ${theme} dashboard screenshot`}><div className="window-chrome"><span /><span /><span /><p>TokenTracking · local dashboard</p><span className="window-local">127.0.0.1</span></div><img src={`/images/dashboard-${theme}.png`} width="2400" alt={`TokenTracking ${theme} dashboard with usage meters, countdowns and history sparklines`} loading="lazy" /></a>
        <p className="screenshot-note">Actual product screenshots with demo data. Click to see the full dashboard.</p>
      </section>

      <section className="settings-section page-width">
        <div className="settings-copy"><p className="eyebrow">Your bar. Your priorities.</p><h2>Keep the numbers<br />that matter to you.</h2><p>Select and reorder your menu bar items. Keep the limits you care about in view, with your preferences saved on your Mac.</p><span className="source-badge">Included in {release.version}</span></div>
        <div className="settings-frame"><img src="/images/settings-dark.png" width="800" height="1122" alt="Menu bar settings with service selection and usage limit choices" loading="lazy" /></div>
      </section>

      <section className="privacy-section page-width"><div className="privacy-mark" aria-hidden="true"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" /></svg></div><p className="eyebrow">Local-first, from the start</p><h2>Your usage stays yours.</h2><p>History is stored on your Mac. Logins stay inside a dedicated Chrome profile. TokenTracking reads your own provider pages, with no API keys and no telemetry.</p><div className="privacy-points"><span>Local history</span><span>No app account</span><span>No analytics</span><span>Open source</span></div><a href={`${release.repository}/blob/main/docs/SECURITY.md`} target="_blank" rel="noopener noreferrer">Read how it works <Arrow /></a></section>

      <section id="install" className="install-section page-width"><div className="section-intro"><div><p className="eyebrow">A few minutes to set up</p><h2>From download to a glance.</h2></div><p>macOS {release.minimumMacOS} or later, plus Google Chrome. Node and the local service are included in the app.</p></div><ol className="install-steps"><li><span>1</span><h3>Drop it into Applications.</h3><p>Download the DMG for your Mac, open it, and drag TokenTracking to Applications.</p></li><li><span>2</span><h3>Connect your subscriptions.</h3><p>Choose Open browser for each service, sign in, then quit that dedicated Chrome window with ⌘Q.</p></li><li><span>3</span><h3>Make room in your menu bar.</h3><p>If needed, enable TokenTracking in System Settings → Menu Bar. Your limits refresh automatically.</p></li></ol><aside className="preview-notice"><span aria-hidden="true">ⓘ</span><div><strong>A note about the preview</strong><p>The current download is ad-hoc signed and isn’t notarized by Apple. If macOS blocks the first launch, attempt to open the app, then use System Settings → Privacy & Security → Open Anyway if you trust this build. Keep Gatekeeper enabled.</p><a href={`${release.repository}/blob/main/docs/RELEASING.md`} target="_blank" rel="noopener noreferrer">Release and installation details ↗</a></div></aside></section>

      <section className="faq-section page-width"><h2>A few things to know.</h2><div className="faqs"><details><summary>Does this need API keys?</summary><p>No. Browser providers are read from their own pages using a separate Chrome profile you sign into once. Antigravity is read from its local language server while the app is running.</p></details><details><summary>Does it track API spending or token counts?</summary><p>It tracks subscription usage limits and pacing. API billing, cost-per-token estimates, and subscription value comparisons are not included.</p></details><details><summary>What if a provider changes its usage page?</summary><p>These readers use undocumented pages and endpoints. They can change, and a meter may temporarily stop updating. The app shows stale readings and refresh errors instead of hiding them. See the provider documentation for the latest verification status.</p></details><details><summary>What happens when I update or uninstall?</summary><p>Quit the app before replacing it in Applications. Updates keep your history and logins in ~/.tokentracking. To uninstall, quit and remove the app; delete that folder separately if you also want to erase its local data.</p></details></div></section>

      <section id="support" className="support-section page-width" aria-labelledby="support-title">
        <div className="support-section-copy"><p className="eyebrow">Free, open source, independently built</p><h2 id="support-title">Help keep it going.</h2><p>If TokenTracking gives you a little more clarity, consider leaving a tip to support the project.</p></div>
        <div className="support-section-action"><SupportLink className="button button-primary" /><span>Optional support · secure checkout with Stripe</span></div>
      </section>
    </main>
    <footer className="site-footer page-width"><div className="footer-main"><a className="brand" href="#"><img src="/images/icon.png" width="28" height="28" alt="" />TokenTracking</a><div><SupportLink /><a className="social-link" href={release.repository} target="_blank" rel="noopener noreferrer"><SocialIcon kind="github" />Source code</a><a href={`${release.repository}/blob/main/README.md`} target="_blank" rel="noopener noreferrer">Documentation</a><a href={`${release.repository}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">MIT license</a></div></div><div className="creator-links"><span>Find me elsewhere</span>{creatorLinks.map(({ label, href, icon }) => <a key={label} href={href} target="_blank" rel="noopener noreferrer">{icon && <SocialIcon kind={icon} />}{label} <span aria-hidden="true">↗</span></a>)}</div><p>An independent project. Not affiliated with or endorsed by the providers shown. Product names and logos belong to their respective owners.</p></footer>
  </>;
}
