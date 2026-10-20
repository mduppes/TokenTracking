import { useState, type ReactNode } from 'react';
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

type FeatureKind = 'usage' | 'pace' | 'order' | 'refresh' | 'save' | 'local' | 'key' | 'shield';
const featurePaths: Record<FeatureKind, string> = {
  usage: 'M4 20V10m8 10V4m8 16v-7M2 20h20',
  pace: 'M4 16a8 8 0 1 1 16 0M12 13l4-5M5 20h14',
  order: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  refresh: 'M20 7v5h-5M4 17v-5h5M6.3 6.3A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.7 5.7',
  save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',
  local: 'M3 4h18v13H3V4Zm4 17h10m-5-4v4',
  key: 'M14 10a5 5 0 1 1-3-4.6L21 2l1 4-3 1 1 3-6 2',
  shield: 'M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7l-9-4Zm-4 9 3 3 5-6',
};
function FeatureIcon({ kind }: { kind: FeatureKind }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={featurePaths[kind]} /></svg>;
}
function FeatureList({ items, className = '' }: { items: [FeatureKind, ReactNode][]; className?: string }) {
  return <ul className={`feature-list ${className}`}>{items.map(([kind, label], i) => <li key={kind + i}><span className="feature-icon"><FeatureIcon kind={kind} /></span><div className="feature-label">{label}</div></li>)}</ul>;
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
          <h1>AI limits in<br />your <span>menu bar.</span></h1>
          <FeatureList className="hero-summary" items={[
            ['usage', <><strong>Usage & resets</strong><span>Across your AI subscriptions</span></>],
            ['pace', <><strong>Usage pacing</strong><span>Plan usage until your next reset</span></>],
            ['order', <><strong>Your menu bar</strong><span>Choose and reorder services</span></>],
          ]} />
          <div className="hero-actions"><DownloadButtons /></div>
          <p className="download-caption">macOS {release.minimumMacOS}+ <span>·</span> Google Chrome required</p>
          <p className="download-caption">Free & open source <span>·</span> Signed & notarized</p>
          <a className="preview-link" href="#install">Setup instructions</a>
          <a className="hero-release-link" href={releaseURL} target="_blank" rel="noopener noreferrer">Preview {release.version} · release notes & checksums ↗</a>
        </div>
        <div className="hero-product" aria-label="TokenTracking screenshots with demo data">
          <div className="menu-strip"><span className="menu-app">TokenTracking</span><div className="menu-crop"><img src="/images/menubar.png" alt="Menu bar with provider icons and usage percentages" /></div></div>
          <div className="hero-panel"><img src="/images/panel-dark.png" width="800" height="1122" alt="Mac panel with usage and upcoming resets" /></div>
          <span className="image-caption">Demo data</span>
        </div>
      </section>

      <section className="provider-section page-width" aria-label="Supported services">
        <p>Supported services</p>
        <div className="providers">{providers.map(([id, name]) => <div className="provider" key={id}><img src={`/providers/${id}.svg`} width="24" height="24" alt="" /><span>{name}</span></div>)}</div>
        <div className="provider-notes"><span>Grok Bot via Cursor</span><span>Antigravity requires its desktop app</span></div>
        <a className="provider-footnote" href={`${release.repository}/blob/main/docs/PROVIDERS.md`} target="_blank" rel="noopener noreferrer">Provider status ↗</a>
      </section>

      <section id="features" className="dashboard-section page-width">
        <div className="section-intro">
          <h2>Usage and pacing</h2>
          <div className="theme-switch" role="group" aria-label="Dashboard screenshot appearance">{(['dark', 'light'] as const).map((value) => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === 'dark' ? 'Dark' : 'Light'}</button>)}</div>
        </div>
        <FeatureList className="feature-grid" items={[
          ['usage', <><strong>Subscription limits</strong><span>Session, weekly and monthly</span></>],
          ['pace', <><strong>History & pacing</strong><span>Reset countdowns and projections</span></>],
          ['refresh', <><strong>Automatic refresh</strong><span>Every 15 minutes; stale readings marked</span></>],
        ]} />
        <a className="dashboard-frame" href={`/images/dashboard-${theme}.png`} target="_blank" rel="noopener noreferrer" aria-label={`Open full ${theme} dashboard screenshot`}><img src={`/images/dashboard-${theme}.png`} width="2400" alt={`Usage dashboard in ${theme} mode`} loading="lazy" /></a>
        <p className="screenshot-note">Demo data · open image for full view</p>
      </section>

      <section className="settings-section page-width">
        <div className="settings-copy">
          <h2>Customize your menu bar</h2>
          <FeatureList items={[
            ['order', 'Select and reorder services'],
            ['usage', 'Choose which limit each item shows'],
            ['save', 'Preferences saved on your Mac'],
          ]} />
        </div>
        <div className="settings-frame"><img src="/images/settings-dark.png" width="800" height="1122" alt="Service selection and usage limit settings" loading="lazy" /></div>
      </section>

      <section className="privacy-section page-width">
        <h2>Local and private</h2>
        <FeatureList className="privacy-grid" items={[
          ['local', <><strong>Local history</strong><span>Stored on your Mac</span></>],
          ['key', <><strong>Private logins</strong><span>Dedicated Chrome profile</span></>],
          ['shield', <><strong>No tracking</strong><span>No API keys, app account or telemetry</span></>],
        ]} />
        <a href={`${release.repository}/blob/main/docs/SECURITY.md`} target="_blank" rel="noopener noreferrer">Privacy details <Arrow /></a>
      </section>

      <section id="install" className="install-section page-width">
        <h2>Setup</h2>
        <ol className="install-steps">
          <li><span>1</span><h3>Install</h3><p>Download the DMG. Drag TokenTracking to Applications and open it.</p></li>
          <li><span>2</span><h3>Sign in</h3><p>Select <strong>Open browser</strong> for each service. Sign in, then quit that browser with <kbd>⌘Q</kbd>.</p></li>
          <li><span>3</span><h3>Choose your services</h3><p>Select menu bar items in Settings. Enable TokenTracking in System Settings → Menu Bar if needed.</p></li>
        </ol>
        <dl className="release-notes"><div><dt>Updates</dt><dd>Quit the app, then replace it in Applications. History and logins are preserved.</dd></div><div><dt>Preview</dt><dd>Provider changes may interrupt readings. Subscription limits only; no API billing or token counts.</dd></div></dl>
      </section>

      <section id="support" className="support-section page-width" aria-labelledby="support-title">
        <div className="support-copy"><h2 id="support-title">A note from the developer</h2><p>Hey, I’m Mark. I built TokenTracking because I wanted a quiet, private way to track my AI limits without another subscription. The app is completely free and open source. If it saves you time in your daily workflow, a tip helps support the hours spent keeping it working as providers change.</p></div>
        <div className="support-section-action"><SupportLink className="button button-primary" label="Support on Stripe" /><span>One-time tip · Stripe checkout</span></div>
      </section>
    </main>
    <footer className="site-footer page-width"><div className="footer-main"><a className="brand" href="#"><img src="/images/icon.png" width="28" height="28" alt="" />TokenTracking</a><div><SupportLink /><a className="social-link" href={release.repository} target="_blank" rel="noopener noreferrer"><SocialIcon kind="github" />Source code</a><a href={`${release.repository}/blob/main/README.md`} target="_blank" rel="noopener noreferrer">Documentation</a><a href={`${release.repository}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">MIT license</a></div></div><div className="creator-links"><span>Creator</span>{creatorLinks.map(({ label, href, icon }) => <a key={label} href={href} target="_blank" rel="noopener noreferrer">{icon && <SocialIcon kind={icon} />}{label} <span aria-hidden="true">↗</span></a>)}</div><p>Independent project. Not affiliated with the providers shown. Trademarks belong to their owners.</p></footer>
  </>;
}
