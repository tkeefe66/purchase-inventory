#!/usr/bin/env tsx
/**
 * Offline curriculum export.
 *
 * Renders all photography topics (theory + assignment + rubric) into a single
 * self-contained HTML file with no external assets — open it on a phone or
 * laptop with zero network. Built for trips with no service: read the theory,
 * shoot the assignments offline, grade later when back online.
 *
 *   npm run export-curriculum            → ./photography-curriculum.html
 *   npm run export-curriculum -- out.html → custom path
 *
 * Content is the static theorySeed/assignmentSeed baked into the skill tree —
 * the same prose the bot polishes at runtime, here in raw form. No Claude call,
 * no cost, no network.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { marked } from 'marked';
import { ALL_TOPICS, type BranchId, type Topic } from '../domains/photography/skillTree.js';

marked.use({ gfm: true, breaks: false });

const BRANCH_ORDER: { id: BranchId; label: string; blurb: string }[] = [
  { id: 'operating-camera', label: 'Operating the Camera', blurb: 'Confident control of the a6700 in any situation.' },
  { id: 'seeing', label: 'Seeing', blurb: 'Making photos that are about something.' },
  { id: 'editing', label: 'Editing', blurb: 'Taking a flat RAW to a finished image (Lightroom Classic).' },
  { id: 'printing', label: 'Printing', blurb: 'Putting prints on the wall (Epson ET-8550).' },
];

const TIER_LABELS: Record<number, string> = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3', 4: 'Tier 4' };

function md(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTopic(t: Topic, n: number): string {
  const prereqs = t.prereqs.length
    ? `<p class="prereqs">Prereqs: ${t.prereqs.map((p) => `<code>${esc(p)}</code>`).join(', ')}</p>`
    : '';
  // data-search holds lowercased text so the client-side filter can match
  // anything in the topic without re-parsing the rendered HTML.
  const haystack = `${t.name} ${t.id} ${t.description} ${t.theorySeed} ${t.assignmentSeed}`.toLowerCase();
  return `
<details class="topic" data-search="${esc(haystack)}">
  <summary><span class="tnum">${n}.</span> ${esc(t.name)}</summary>
  <div class="body">
    <p class="desc">${esc(t.description)}</p>
    ${prereqs}
    <h4>Theory</h4>
    <div class="prose">${md(t.theorySeed)}</div>
    <h4>Assignment</h4>
    <div class="prose">${md(t.assignmentSeed)}</div>
  </div>
</details>`;
}

function build(): string {
  let toc = '';
  let body = '';
  let topicCount = 0;

  for (const branch of BRANCH_ORDER) {
    const topics = ALL_TOPICS.filter((t) => t.branch === branch.id);
    if (topics.length === 0) continue;
    toc += `<li><a href="#${branch.id}">${esc(branch.label)}</a> <span class="muted">(${topics.length})</span></li>`;
    body += `<section class="branch" id="${branch.id}">
      <h2>${esc(branch.label)}</h2>
      <p class="blurb">${esc(branch.blurb)}</p>`;
    const tiers = [...new Set(topics.map((t) => t.tier))].sort((a, b) => a - b);
    for (const tier of tiers) {
      body += `<h3 class="tier">${TIER_LABELS[tier] ?? `Tier ${tier}`}</h3>`;
      for (const t of topics.filter((x) => x.tier === tier)) {
        topicCount += 1;
        body += renderTopic(t, topicCount);
      }
    }
    body += `</section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Photography Curriculum (Offline)</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0; padding: 0 1rem 4rem;
    max-width: 820px; margin-inline: auto;
    color: #1a1a1a; background: #fff;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e6e6; background: #161616; }
    code { background: #2a2a2a; }
    .topic { border-color: #333; }
    summary { background: #1e1e1e; }
    summary:hover { background: #242424; }
    .controls { background: #161616cc; }
    a { color: #6db3f2; }
    blockquote { border-color: #444; color: #aaa; }
  }
  header.top { padding: 1.5rem 0 0.5rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  .sub { color: #777; margin: 0 0 1rem; font-size: .95rem; }
  .controls { position: sticky; top: 0; padding: .6rem 0; background: #ffffffcc; backdrop-filter: blur(6px); z-index: 5; }
  #q { width: 100%; padding: .6rem .8rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 8px; }
  .toc { margin: .5rem 0 1.5rem; padding-left: 1.2rem; }
  .toc li { margin: .15rem 0; }
  .muted { color: #999; font-size: .85rem; }
  section.branch { margin: 2rem 0; }
  h2 { font-size: 1.35rem; border-bottom: 2px solid currentColor; padding-bottom: .25rem; }
  .blurb { color: #777; margin-top: -.3rem; }
  h3.tier { font-size: 1rem; text-transform: uppercase; letter-spacing: .05em; color: #888; margin: 1.4rem 0 .5rem; }
  .topic { border: 1px solid #e2e2e2; border-radius: 8px; margin: .5rem 0; overflow: hidden; }
  summary { cursor: pointer; padding: .7rem .9rem; font-weight: 600; background: #f7f7f7; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: "▸"; display: inline-block; width: 1rem; color: #999; }
  details[open] summary::before { content: "▾"; }
  .tnum { color: #999; font-weight: 400; margin-right: .25rem; }
  .body { padding: .2rem 1rem 1rem; }
  .desc { font-style: italic; color: #777; }
  .prereqs { font-size: .85rem; color: #999; }
  h4 { margin: 1.1rem 0 .3rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: #888; }
  code { background: #f0f0f0; padding: .1em .35em; border-radius: 4px; font-size: .9em; }
  blockquote { border-left: 3px solid #ddd; margin: .5rem 0; padding-left: .9rem; color: #666; }
  .prose ul { padding-left: 1.3rem; }
  .nohit { display: none; }
  .count { color: #888; font-size: .85rem; margin: .3rem 0; }
  footer { margin-top: 3rem; color: #999; font-size: .85rem; text-align: center; }
</style>
</head>
<body>
<header class="top">
  <h1>📷 Photography Curriculum</h1>
  <p class="sub">${topicCount} topics · theory + assignment · fully offline</p>
</header>
<div class="controls">
  <input id="q" type="search" placeholder="Search topics, theory, assignments…" autocomplete="off">
  <div class="count" id="count"></div>
</div>
<nav>
  <strong>Branches</strong>
  <ul class="toc">${toc}</ul>
</nav>
${body}
<footer>Generated offline from the skill tree · open assignments, shoot them, grade later when back online.</footer>
<script>
  const q = document.getElementById('q');
  const count = document.getElementById('count');
  const topics = Array.from(document.querySelectorAll('.topic'));
  const sections = Array.from(document.querySelectorAll('section.branch'));
  function apply() {
    const term = q.value.trim().toLowerCase();
    let shown = 0;
    for (const t of topics) {
      const hit = !term || t.dataset.search.includes(term);
      t.classList.toggle('nohit', !hit);
      if (hit) shown++;
      if (term && hit) t.setAttribute('open', '');
    }
    // Hide branch sections with no visible topics while searching.
    for (const s of sections) {
      const any = s.querySelectorAll('.topic:not(.nohit)').length > 0;
      s.classList.toggle('nohit', !!term && !any);
    }
    count.textContent = term ? shown + ' match' + (shown === 1 ? '' : 'es') : '';
  }
  q.addEventListener('input', apply);
</script>
</body>
</html>`;
}

function main(): void {
  const outArg = process.argv[2];
  const outPath = resolve(process.cwd(), outArg || 'photography-curriculum.html');
  const html = build();
  writeFileSync(outPath, html, 'utf8');
  const topics = ALL_TOPICS.length;
  console.log(`Wrote ${topics} topics → ${outPath}`);
  console.log('Open it in any browser (phone or laptop) — no network needed.');
}

main();
