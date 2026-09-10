// scripts/trophy-icons.mjs
// ---------------------------------------------------------------------------
// React Icons for the trophies card — no emojis, no runtime dependencies.
//
// These are the exact path definitions behind the `react-icons/tb` (Tabler)
// components listed next to each key. They are inlined as raw SVG because
// GitHub shows ./assets/*.svg through an <img> tag, and browsers block every
// external resource (fonts, <image href="https://...">) inside an SVG loaded
// that way. Inline paths are the only icons guaranteed to render on GitHub.
// ---------------------------------------------------------------------------

export const ICONS = {
  // <TbPackage />
  repos: [
    '<path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5"/>',
    '<path d="M12 12l8 -4.5"/>',
    '<path d="M12 12l0 9"/>',
    '<path d="M12 12l-8 -4.5"/>',
    '<path d="M16 5.25l-8 4.5"/>',
  ],
  // <TbGitCommit />
  commits: [
    '<circle cx="12" cy="12" r="3"/>',
    '<path d="M12 3l0 6"/>',
    '<path d="M12 15l0 6"/>',
  ],
  // <TbGitPullRequest />
  pullRequests: [
    '<circle cx="6" cy="18" r="2"/>',
    '<circle cx="6" cy="6" r="2"/>',
    '<circle cx="18" cy="18" r="2"/>',
    '<path d="M6 8l0 8"/>',
    '<path d="M11 6h5a2 2 0 0 1 2 2v8"/>',
    '<path d="M14 9l-3 -3l3 -3"/>',
  ],
  // <TbUsers />
  followers: [
    '<circle cx="9" cy="7" r="4"/>',
    '<path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
    '<path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    '<path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/>',
  ],
  // <TbStar />
  stars: [
    '<path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z"/>',
  ],
  // <TbFlame />
  streak: [
    '<path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z"/>',
  ],
};

/**
 * Returns an SVG fragment for one icon, centred horizontally on `cx`.
 * Drop it anywhere your generator currently writes the emoji <text> node.
 */
export function trophyIcon(name, { cx, y, size = 36, color = '#38bdf8', strokeWidth = 2 }) {
  const parts = ICONS[name];
  if (!parts) throw new Error(`trophyIcon: unknown icon "${name}"`);
  const scale = size / 24;
  const x = cx - size / 2;
  return (
    `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    parts.join('') +
    `</g>`
  );
}

// ---------------------------------------------------------------------------
// Full card renderer — same layout, palette and tiers as your current
// github-trophies.svg, with the emojis swapped for the icons above.
// Keep your existing data fetching and tier logic; just pass the results in.
// ---------------------------------------------------------------------------

export const TIER_COLORS = {
  platinum: { text: '#38bdf8', border: '#1e6a8f' },
  gold:     { text: '#f5a60b', border: '#8a6612' },
  silver:   { text: '#94a3b8', border: '#4b5563' },
  bronze:   { text: '#c2570c', border: '#6b3410' },
  none:     { text: '#64748b', border: '#334155' },
};

/**
 * @param {Array<{icon: keyof ICONS, value: number|string, label: string, tier?: string}>} items
 *        Six items, rendered left-to-right, top-to-bottom.
 */
export function renderTrophies(items) {
  const W = 820, H = 432;
  const pad = 24, gap = 20, cols = 3;
  const rows = Math.ceil(items.length / cols);
  const cardW = (W - pad * 2 - gap * (cols - 1)) / cols;
  const cardH = (H - pad * 2 - gap * (rows - 1)) / rows;
  const font = `'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif`;

  const cards = items.map((item, i) => {
    const tierKey = (item.tier || 'none').toLowerCase();
    const tier = TIER_COLORS[tierKey] || TIER_COLORS.none;
    const x = pad + (i % cols) * (cardW + gap);
    const y = pad + Math.floor(i / cols) * (cardH + gap);
    const cx = x + cardW / 2;
    const tierLabel = tierKey === 'none' ? '—' : tierKey.toUpperCase();

    return `
  <g>
    <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="16" fill="#131a26" stroke="${tier.border}" stroke-width="1.5"/>
    ${trophyIcon(item.icon, { cx, y: y + 22, size: 34, color: tier.text })}
    <text x="${cx}" y="${y + 94}" text-anchor="middle" font-family="${font}" font-size="30" font-weight="700" fill="#ffffff">${item.value}</text>
    <text x="${cx}" y="${y + 123}" text-anchor="middle" font-family="${font}" font-size="15" fill="#cbd5e1">${item.label}</text>
    <text x="${cx}" y="${y + 152}" text-anchor="middle" font-family="${font}" font-size="13" font-weight="700" letter-spacing="2" fill="${tier.text}">${tierLabel}</text>
  </g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub achievement trophies">
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="20" fill="#0b0f17" stroke="#1e293b" stroke-width="1.5"/>${cards}
</svg>
`;
}
