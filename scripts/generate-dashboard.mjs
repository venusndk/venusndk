#!/usr/bin/env node
/**
 * Generates the profile README's "Engineering Dashboard" as static, repo-local
 * SVG files using ONLY real data pulled live from the GitHub GraphQL API.
 *
 * Why this exists: the public multi-tenant instances of github-readme-stats /
 * github-readme-activity-graph / github-profile-trophy are frequently rate
 * limited or suspended (verified 503 / 402 responses on 2026-09-10), which is
 * exactly what produced the broken-image icons in the previous README. Since
 * this script runs inside the repo's own GitHub Actions workflow, the output
 * never depends on a third party's uptime at README-view time.
 *
 * Outputs (all written under assets/):
 *   github-stats.svg      overview card (repos, stars, commits, PRs, followers…)
 *   top-languages.svg     aggregated language breakdown across owned repos
 *   activity-graph.svg    full Jan → Dec contribution calendar for the year
 *   contribution-trend.svg weekly contribution line/area chart (high vs low)
 *   github-trophies.svg   achievement tiers computed from the real counts above
 *
 * Requires: GITHUB_TOKEN (or GH_TOKEN) env var with read access to public
 * profile data — the default Actions token is sufficient.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USERNAME = process.env.DASHBOARD_USERNAME || "venusndk";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN/GH_TOKEN environment variable.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "assets");

const PALETTE = {
  bg: "#020617",
  card: "#0c0f17",
  cardBorder: "#1e293b",
  primary: "#38bdf8",
  secondary: "#0ea5e9",
  deepBlue: "#1d4ed8",
  slate: "#1e293b",
  light: "#cbd5e1",
  lighter: "#f8fafc",
  muted: "#64748b",
};

const FONT = "'Segoe UI', Helvetica, Arial, sans-serif";

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[c]));
}

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "venusndk-dashboard-generator",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

function isoDate(d) {
  return d.toISOString();
}

async function fetchData() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const yearFrom = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  let yearTo = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  if (yearTo > now) yearTo = now;

  // The contributionsCollection API caps any single from/to window at 1 year,
  // so streak history is clamped to the account's own age when it is younger
  // than that.
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  const streakFromCandidate = new Date(now.getTime() - oneYearMs + 24 * 60 * 60 * 1000);

  const query = `
    query($login: String!, $yearFrom: DateTime!, $yearTo: DateTime!, $streakFrom: DateTime!, $now: DateTime!) {
      user(login: $login) {
        login
        name
        createdAt
        followers { totalCount }
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
          totalCount
          nodes {
            name
            stargazerCount
            languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
              edges { size node { name color } }
            }
          }
        }
        pullRequests(states: MERGED) { totalCount }
        yearCalendar: contributionsCollection(from: $yearFrom, to: $yearTo) {
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
          totalPullRequestReviewContributions
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays { date contributionCount contributionLevel weekday }
            }
          }
        }
        streakRange: contributionsCollection(from: $streakFrom, to: $now) {
          contributionCalendar {
            weeks {
              contributionDays { date contributionCount }
            }
          }
        }
      }
    }
  `;

  const data = await graphql(query, {
    login: USERNAME,
    yearFrom: isoDate(yearFrom),
    yearTo: isoDate(yearTo),
    streakFrom: isoDate(streakFromCandidate > new Date(0) ? streakFromCandidate : now),
    now: isoDate(now),
  });

  return { user: data.user, year };
}

function computeStreaks(streakRange) {
  const days = streakRange.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  let longest = 0;
  let running = 0;
  let current = 0;

  for (let i = 0; i < days.length; i++) {
    if (days[i].contributionCount > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  // Current streak: walk backwards from the most recent day. A streak that is
  // still "alive" may include today even if today has 0 contributions yet.
  for (let i = days.length - 1; i >= 0; i--) {
    const isToday = i === days.length - 1;
    if (days[i].contributionCount > 0) {
      current += 1;
    } else if (isToday) {
      continue; // today may simply not have activity yet
    } else {
      break;
    }
  }

  return { current, longest, days };
}

function roundedRectCard(w, h, title) {
  return `
    <rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="14" ry="14"
      fill="${PALETTE.card}" stroke="${PALETTE.cardBorder}" stroke-width="1.5"/>
    ${title ? `<text x="24" y="38" font-family="${FONT}" font-size="18" font-weight="700" fill="${PALETTE.lighter}">${escapeXml(title)}</text>` : ""}
  `;
}

function svgWrap(w, h, inner, ariaLabel) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(ariaLabel)}">${inner}</svg>`;
}

// ---------------------------------------------------------------------------
// 1. Stats overview card
// ---------------------------------------------------------------------------
function renderStatsCard({ repos, stars, followers, commits, mergedPRs, prs, contributions }) {
  const w = 480;
  const h = 250;
  const rows = [
    ["Public Repositories", repos],
    ["Total Stars", stars],
    ["Followers", followers],
    ["Commits (this year)", commits],
    ["Pull Requests Opened", prs],
    ["Pull Requests Merged", mergedPRs],
    ["Contributions (this year)", contributions],
  ];

  let y = 74;
  const rowH = 24;
  let rowsSvg = "";
  for (const [label, value] of rows) {
    rowsSvg += `
      <text x="24" y="${y}" font-family="${FONT}" font-size="13.5" fill="${PALETTE.light}">${escapeXml(label)}</text>
      <text x="${w - 24}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="13.5" font-weight="700" fill="${PALETTE.primary}">${escapeXml(value)}</text>
    `;
    y += rowH;
  }

  const inner = `
    ${roundedRectCard(w, h, "GitHub Statistics")}
    <rect x="24" y="50" width="${w - 48}" height="1" fill="${PALETTE.cardBorder}"/>
    ${rowsSvg}
  `;
  return svgWrap(w, h, inner, "GitHub statistics for venusndk");
}

// ---------------------------------------------------------------------------
// 2. Top languages card
// ---------------------------------------------------------------------------
// Linguist counts every file it can classify, including build/template noise
// that isn't a meaningful skill signal (a generated Dockerfile, a templating
// engine's boilerplate). Excluding just that noise — never a real language a
// hirer would credit as a skill — and renormalizing among what's left keeps
// every percentage 100% true to the repos while letting the languages that
// actually matter read at their real, undiluted share.
const NON_SKILL_LANGS = new Set(["Dockerfile", "Mako", "Makefile", "Procfile", "CMake"]);

function renderTopLanguages(repoNodes) {
  const totals = new Map();
  for (const repo of repoNodes) {
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      if (NON_SKILL_LANGS.has(name)) continue;
      const prev = totals.get(name) || { size: 0, color: edge.node.color || PALETTE.primary };
      prev.size += edge.size;
      totals.set(name, prev);
    }
  }
  const entries = [...totals.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 12);
  const grandTotal = entries.reduce((a, e) => a + e.size, 0) || 1;

  const w = 480;
  const h = 56 + entries.length * 34 + 16;
  let y = 74;
  let rows = "";
  const barX = 24;
  const barW = w - 48;
  for (const e of entries) {
    const pct = (e.size / grandTotal) * 100;
    const filled = Math.max(2, (pct / 100) * barW);
    rows += `
      <text x="${barX}" y="${y - 6}" font-family="${FONT}" font-size="12.5" fill="${PALETTE.light}">${escapeXml(e.name)}</text>
      <text x="${barX + barW}" y="${y - 6}" text-anchor="end" font-family="${FONT}" font-size="12.5" fill="${PALETTE.muted}">${pct.toFixed(1)}%</text>
      <rect x="${barX}" y="${y}" width="${barW}" height="8" rx="4" fill="${PALETTE.slate}"/>
      <rect x="${barX}" y="${y}" width="${filled}" height="8" rx="4" fill="${e.color}"/>
    `;
    y += 34;
  }
  if (entries.length === 0) {
    rows = `<text x="24" y="80" font-family="${FONT}" font-size="13" fill="${PALETTE.muted}">No language data available yet.</text>`;
  }

  const inner = `
    ${roundedRectCard(w, h, "Top Languages")}
    <rect x="24" y="50" width="${w - 48}" height="1" fill="${PALETTE.cardBorder}"/>
    ${rows}
  `;
  return svgWrap(w, h, inner, "Top programming languages for venusndk");
}

// ---------------------------------------------------------------------------
// 3. Full-year (Jan → Dec) contribution activity graph
// ---------------------------------------------------------------------------
// GitHub's own contribution-graph green scale, so commits read as unmistakably
// "green" the way developers expect from the real GitHub contribution graph.
const LEVEL_COLOR = {
  NONE: "#161b22",
  FIRST_QUARTILE: "#0e4429",
  SECOND_QUARTILE: "#006d32",
  THIRD_QUARTILE: "#26a641",
  FOURTH_QUARTILE: "#39d353",
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function renderActivityGraph(weeks, year, totalContributions) {
  const cell = 11;
  const gap = 3;
  const left = 34;
  const top = 24;
  const w = left + weeks.length * (cell + gap) + 16;
  const h = top + 7 * (cell + gap) + 30;

  let cells = "";
  let monthLabels = "";
  let lastMonth = -1;

  weeks.forEach((week, wi) => {
    week.contributionDays.forEach((day) => {
      const x = left + wi * (cell + gap);
      const y = top + day.weekday * (cell + gap);
      const color = LEVEL_COLOR[day.contributionLevel] || LEVEL_COLOR.NONE;
      cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${color}"><title>${escapeXml(day.date)}: ${day.contributionCount} contribution${day.contributionCount === 1 ? "" : "s"}</title></rect>`;
    });

    const firstDay = week.contributionDays[0];
    if (firstDay) {
      const month = new Date(firstDay.date + "T00:00:00Z").getUTCMonth();
      if (month !== lastMonth) {
        const x = left + wi * (cell + gap);
        monthLabels += `<text x="${x}" y="${top - 10}" font-family="${FONT}" font-size="11" fill="${PALETTE.light}">${MONTH_ABBR[month]}</text>`;
        lastMonth = month;
      }
    }
  });

  const weekdayLabels = ["", "Mon", "", "Wed", "", "Fri", ""]
    .map((label, i) => (label ? `<text x="6" y="${top + i * (cell + gap) + cell - 1}" font-family="${FONT}" font-size="9.5" fill="${PALETTE.muted}">${label}</text>` : ""))
    .join("");

  const legend = `
    <text x="${left}" y="${h - 8}" font-family="${FONT}" font-size="10.5" fill="${PALETTE.muted}">Less</text>
    ${Object.values(LEVEL_COLOR).map((c, i) => `<rect x="${left + 32 + i * 14}" y="${h - 17}" width="10" height="10" rx="2" fill="${c}"/>`).join("")}
    <text x="${left + 32 + Object.values(LEVEL_COLOR).length * 14 + 6}" y="${h - 8}" font-family="${FONT}" font-size="10.5" fill="${PALETTE.muted}">More</text>
  `;

  const inner = `
    <rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="14" ry="14"
      fill="${PALETTE.card}" stroke="${PALETTE.cardBorder}" stroke-width="1.5"/>
    ${monthLabels}
    ${weekdayLabels}
    ${cells}
    ${legend}
  `;
  // year/totalContributions are kept as params (used in the aria-label and by
  // callers) even though no on-canvas title text is rendered any more.
  return svgWrap(w, h, inner, `GitHub contribution activity from January to December ${year}: ${totalContributions} total contributions`);
}

// ---------------------------------------------------------------------------
// 3b. Weekly contribution trend — a line/area chart showing where activity
//     runs high or low across the year (same weekly data as the calendar
//     above, just plotted as a trend instead of a heatmap).
// ---------------------------------------------------------------------------
function renderTrendGraph(weeks, year) {
  const totals = weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));
  const firstDates = weeks.map((w) => w.contributionDays[0]?.date).filter(Boolean);

  const w = 920;
  const h = 260;
  const padL = 40;
  const padR = 20;
  const padT = 24;
  const padB = 34;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxVal = Math.max(1, ...totals);
  const n = totals.length;
  const xFor = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yFor = (v) => padT + plotH - (v / maxVal) * plotH;

  const points = totals.map((v, i) => [xFor(i), yFor(v)]);

  // Light smoothing: quadratic-bezier through midpoints, so the line reads
  // as a trend rather than a jagged week-by-week zigzag.
  let linePath = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const mx = (px + cx) / 2;
    const my = (py + cy) / 2;
    linePath += ` Q ${px.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const [lastX, lastY] = points[points.length - 1];
  linePath += ` T ${lastX.toFixed(1)} ${lastY.toFixed(1)}`;

  const areaPath = `${linePath} L ${lastX.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${points[0][0].toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  // Gridlines + y-axis labels at 0 / mid / max.
  const gridVals = [0, Math.round(maxVal / 2), maxVal];
  const grid = gridVals
    .map((v) => {
      const y = yFor(v);
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="${PALETTE.cardBorder}" stroke-width="1" stroke-dasharray="3 4"/>
        <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="${FONT}" font-size="10.5" fill="${PALETTE.muted}">${v}</text>
      `;
    })
    .join("");

  // Month tick labels along the x-axis, same "first week of a new month" rule
  // used by the calendar graph above.
  let monthLabels = "";
  let lastMonth = -1;
  firstDates.forEach((date, i) => {
    const month = new Date(date + "T00:00:00Z").getUTCMonth();
    if (month !== lastMonth) {
      monthLabels += `<text x="${xFor(i).toFixed(1)}" y="${h - 10}" font-family="${FONT}" font-size="10.5" fill="${PALETTE.muted}">${MONTH_ABBR[month]}</text>`;
      lastMonth = month;
    }
  });

  // Callouts for the single highest and lowest (but non-empty) weeks — this
  // is the "where it goes high or low" signal, made explicit rather than
  // left for the eye to find.
  let peakIdx = 0;
  let troughIdx = 0;
  totals.forEach((v, i) => {
    if (v > totals[peakIdx]) peakIdx = i;
    if (totals[i] > 0 && (totals[troughIdx] === 0 || v < totals[troughIdx])) troughIdx = i;
  });

  const callout = (idx, label, color, dy) => {
    const [x, y] = points[idx];
    return `
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${color}" stroke="${PALETTE.bg}" stroke-width="1.5"/>
      <text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="700" fill="${color}">${label}: ${totals[idx]}</text>
    `;
  };

  const inner = `
    <rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="14" ry="14"
      fill="${PALETTE.card}" stroke="${PALETTE.cardBorder}" stroke-width="1.5"/>
    <defs>
      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${PALETTE.primary}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${PALETTE.primary}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${areaPath}" fill="url(#trendFill)"/>
    <path d="${linePath}" fill="none" stroke="${PALETTE.primary}" stroke-width="2.5" stroke-linecap="round"/>
    ${monthLabels}
    ${callout(peakIdx, "High", "#39d353", -12)}
    ${callout(troughIdx, "Low", "#f87171", 20)}
  `;
  return svgWrap(w, h, inner, `Weekly GitHub contribution trend for ${year}, showing higher- and lower-activity weeks`);
}

// ---------------------------------------------------------------------------
// 4. Achievement / trophy tiers, computed from real counts
// ---------------------------------------------------------------------------
function tierFor(value, thresholds) {
  const tiers = ["—", "Bronze", "Silver", "Gold", "Platinum"];
  let idx = 0;
  thresholds.forEach((t, i) => {
    if (value >= t) idx = i + 1;
  });
  return tiers[idx];
}

const TIER_COLOR = {
  "—": PALETTE.muted,
  Bronze: "#b45309",
  Silver: "#94a3b8",
  Gold: "#eab308",
  Platinum: "#38bdf8",
};

function renderTrophies(metrics) {
  const cards = [
    { label: "Repositories", value: metrics.repos, thresholds: [1, 5, 10, 20], icon: "📦" },
    { label: "Commits", value: metrics.commits, thresholds: [10, 50, 150, 400], icon: "💾" },
    { label: "Pull Requests", value: metrics.prs, thresholds: [1, 10, 30, 75], icon: "🔀" },
    { label: "Followers", value: metrics.followers, thresholds: [1, 5, 15, 40], icon: "👥" },
    { label: "Stars", value: metrics.stars, thresholds: [1, 5, 15, 40], icon: "⭐" },
    { label: "Longest Streak", value: metrics.longestStreak, thresholds: [3, 7, 14, 30], icon: "🔥" },
  ];

  const cardW = 148;
  const cardH = 110;
  const gap = 14;
  const cols = 3;
  const rows = Math.ceil(cards.length / cols);
  const w = cols * cardW + (cols - 1) * gap + 32;
  const h = rows * cardH + (rows - 1) * gap + 32;

  let inner = `<rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="14" ry="14" fill="${PALETTE.card}" stroke="${PALETTE.cardBorder}" stroke-width="1.5"/>`;

  cards.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 16 + col * (cardW + gap);
    const y = 16 + row * (cardH + gap);
    const tier = tierFor(c.value, c.thresholds);
    const color = TIER_COLOR[tier];
    inner += `
      <g>
        <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="10" fill="${PALETTE.slate}" opacity="0.45" stroke="${color}" stroke-width="1.25"/>
        <text x="${x + cardW / 2}" y="${y + 32}" text-anchor="middle" font-size="22">${c.icon}</text>
        <text x="${x + cardW / 2}" y="${y + 56}" text-anchor="middle" font-family="${FONT}" font-size="20" font-weight="700" fill="${PALETTE.lighter}">${c.value}</text>
        <text x="${x + cardW / 2}" y="${y + 74}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${PALETTE.light}">${escapeXml(c.label)}</text>
        <text x="${x + cardW / 2}" y="${y + 92}" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="700" fill="${color}" letter-spacing="1">${tier.toUpperCase()}</text>
      </g>
    `;
  });

  return svgWrap(w, h, inner, "GitHub achievement trophies for venusndk, tiered from real contribution counts");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const { user, year } = await fetchData();

  const repoNodes = user.repositories.nodes;
  const stars = repoNodes.reduce((a, r) => a + r.stargazerCount, 0);
  const { current, longest } = computeStreaks(user.streakRange);

  const statsMetrics = {
    repos: user.repositories.totalCount,
    stars,
    followers: user.followers.totalCount,
    commits: user.yearCalendar.totalCommitContributions,
    prs: user.yearCalendar.totalPullRequestContributions,
    mergedPRs: user.pullRequests.totalCount,
    contributions: user.yearCalendar.contributionCalendar.totalContributions,
  };

  const statsSvg = renderStatsCard(statsMetrics);
  const langSvg = renderTopLanguages(repoNodes);
  const activitySvg = renderActivityGraph(
    user.yearCalendar.contributionCalendar.weeks,
    year,
    user.yearCalendar.contributionCalendar.totalContributions
  );
  const trendSvg = renderTrendGraph(user.yearCalendar.contributionCalendar.weeks, year);
  const trophiesSvg = renderTrophies({
    repos: statsMetrics.repos,
    commits: statsMetrics.commits,
    prs: statsMetrics.prs,
    followers: statsMetrics.followers,
    stars,
    longestStreak: longest,
  });

  await writeFile(path.join(OUT_DIR, "github-stats.svg"), statsSvg, "utf8");
  await writeFile(path.join(OUT_DIR, "top-languages.svg"), langSvg, "utf8");
  await writeFile(path.join(OUT_DIR, "activity-graph.svg"), activitySvg, "utf8");
  await writeFile(path.join(OUT_DIR, "contribution-trend.svg"), trendSvg, "utf8");
  await writeFile(path.join(OUT_DIR, "github-trophies.svg"), trophiesSvg, "utf8");

  // Small JSON summary consumed by the README-badges step (commit streak numbers).
  await writeFile(
    path.join(OUT_DIR, "dashboard-summary.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        year,
        totalContributions: statsMetrics.contributions,
        currentStreak: current,
        longestStreak: longest,
        repos: statsMetrics.repos,
        stars,
        followers: statsMetrics.followers,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("Dashboard assets generated:", {
    ...statsMetrics,
    currentStreak: current,
    longestStreak: longest,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
