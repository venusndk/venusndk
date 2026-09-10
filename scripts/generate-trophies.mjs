#!/usr/bin/env node
// scripts/generate-trophies.mjs
// ---------------------------------------------------------------------------
// Builds assets/github-trophies.svg from live GitHub data, using the
// React Icons (Tabler) set in ./trophy-icons.mjs instead of emojis.
//
// Run in GitHub Actions right after generate-dashboard.mjs:
//   node scripts/generate-trophies.mjs
// Env:
//   GITHUB_TOKEN   required (the default Actions token is enough)
//   GH_USER        optional, defaults to venusndk
//   TROPHIES_OUT   optional, defaults to assets/github-trophies.svg
//
// If any request fails, nothing is written, so the last good SVG stays live.
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderTrophies } from './trophy-icons.mjs';

const LOGIN = process.env.GH_USER || 'venusndk';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const OUT = process.env.TROPHIES_OUT || 'assets/github-trophies.svg';

// Minimum value needed for each tier.
export const THRESHOLDS = {
  repos:        { bronze: 1,  silver: 5,   gold: 20,  platinum: 50 },
  commits:      { bronze: 10, silver: 100, gold: 250, platinum: 1000 },
  pullRequests: { bronze: 1,  silver: 10,  gold: 30,  platinum: 75 },
  followers:    { bronze: 1,  silver: 10,  gold: 50,  platinum: 200 },
  stars:        { bronze: 1,  silver: 10,  gold: 50,  platinum: 200 },
  streak:       { bronze: 3,  silver: 7,   gold: 20,  platinum: 60 },
};

export function tierFor(metric, value) {
  const t = THRESHOLDS[metric];
  if (value >= t.platinum) return 'platinum';
  if (value >= t.gold) return 'gold';
  if (value >= t.silver) return 'silver';
  if (value >= t.bronze) return 'bronze';
  return 'none';
}

/** Longest run of consecutive days with at least one contribution. */
export function longestStreak(days) {
  const active = [...new Set(days.filter(d => d.contributionCount > 0).map(d => d.date))].sort();
  let best = 0, run = 0, prev = null;
  for (const date of active) {
    const t = Date.parse(`${date}T00:00:00Z`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export function buildItems(s) {
  return [
    { icon: 'repos',        value: s.repos,        label: 'Repositories',   tier: tierFor('repos', s.repos) },
    { icon: 'commits',      value: s.commits,      label: 'Commits',        tier: tierFor('commits', s.commits) },
    { icon: 'pullRequests', value: s.pullRequests, label: 'Pull Requests',  tier: tierFor('pullRequests', s.pullRequests) },
    { icon: 'followers',    value: s.followers,    label: 'Followers',      tier: tierFor('followers', s.followers) },
    { icon: 'stars',        value: s.stars,        label: 'Stars',          tier: tierFor('stars', s.stars) },
    { icon: 'streak',       value: s.streak,       label: 'Longest Streak', tier: tierFor('streak', s.streak) },
  ];
}

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${LOGIN}-trophies`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    throw new Error(`GitHub GraphQL ${res.status}: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

async function fetchStats() {
  // Profile totals + owned repositories (paginated for star count).
  let repos = 0, stars = 0, followers = 0, pullRequests = 0, years = [];
  let after = null;
  do {
    const { user } = await gql(
      `query($login: String!, $after: String) {
        user(login: $login) {
          followers { totalCount }
          pullRequests { totalCount }
          contributionsCollection { contributionYears }
          repositories(ownerAffiliations: OWNER, first: 100, after: $after) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { stargazerCount }
          }
        }
      }`,
      { login: LOGIN, after },
    );
    if (!user) throw new Error(`User "${LOGIN}" not found`);
    followers = user.followers.totalCount;
    pullRequests = user.pullRequests.totalCount;
    years = user.contributionsCollection.contributionYears;
    repos = user.repositories.totalCount;
    stars += user.repositories.nodes.reduce((sum, r) => sum + r.stargazerCount, 0);
    after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
  } while (after);

  // All-time commits and contribution days, one request per year.
  let commits = 0;
  const days = [];
  for (const year of years) {
    const { user } = await gql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            restrictedContributionsCount
            contributionCalendar { weeks { contributionDays { date contributionCount } } }
          }
        }
      }`,
      { login: LOGIN, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    );
    const c = user.contributionsCollection;
    commits += c.totalCommitContributions + c.restrictedContributionsCount;
    for (const w of c.contributionCalendar.weeks) days.push(...w.contributionDays);
  }

  return { repos, commits, pullRequests, followers, stars, streak: longestStreak(days) };
}

async function main() {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not set');
  const stats = await fetchStats();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, renderTrophies(buildItems(stats)));
  console.log(`Trophies written to ${OUT}:`, stats);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(`Trophies not updated (previous SVG kept): ${err.message}`);
    process.exit(1);
  });
}
