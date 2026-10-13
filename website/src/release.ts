// Keep preview signing status and URLs in sync with GitHub Releases and docs/RELEASING.md.
export const release = {
  version: '0.6.0-preview.1',
  tag: 'v0.6.0-preview.1',
  preview: true,
  repository: 'https://github.com/mduppes/TokenTracking',
  minimumMacOS: '13',
};
export const releaseURL = `${release.repository}/releases/tag/${release.tag}`;
export const downloadURL = (architecture: 'arm64' | 'x64') =>
  `${release.repository}/releases/download/${release.tag}/TokenTracking-${release.version}-${architecture}.dmg`;
