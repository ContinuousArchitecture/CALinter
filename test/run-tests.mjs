import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'sample-repo');
const enginePath = path.join(repoRoot, 'src', 'engine.mjs');
const markdownViewerPath = path.join(repoRoot, 'test', 'render-markdown.mjs');
const tempSummary = path.join(os.tmpdir(), 'calinter-summary.md');
const tempHtml = path.join(os.tmpdir(), 'calinter-summary.html');

assertFixtureExists(fixtureRoot);
runEngine(enginePath, ['--mode', 'validate', '--repo-root', fixtureRoot]);
runEngine(enginePath, ['--mode', 'summary', '--repo-root', fixtureRoot], {
  GITHUB_STEP_SUMMARY: tempSummary,
});

renderMarkdown(markdownViewerPath, tempSummary, tempHtml);

const qualityScore = readJson(path.join(repoRoot, 'reports', 'quality-score.json'));
const quickchart = readJson(path.join(repoRoot, 'reports', 'quickchart-radar.json'));
const catalog = readJson(path.join(repoRoot, 'reports', 'catalog.json'));
const ruleResults = readJson(path.join(repoRoot, 'reports', 'rule-results.json'));

printReport(catalog, ruleResults, qualityScore, quickchart);

if (qualityScore.status !== 'incomplete') {
  throw new Error(`Expected quality-score.json to be incomplete, got '${qualityScore.status}'.`);
}

if (quickchart.partial !== true) {
  throw new Error('Expected quickchart-radar.json to be partial.');
}

if (catalog.metadata?.source !== 'artifact/source/design.archimate') {
  throw new Error(`Expected catalog.json source to be artifact/source/design.archimate, got '${catalog.metadata?.source}'.`);
}

if (!fs.existsSync(tempSummary)) {
  throw new Error('Expected summary markdown to be generated.');
}

console.log('CALinter local tests passed.');

function assertFixtureExists(fixturePath) {
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing fixture repo: ${fixturePath}`);
  }
}

function runEngine(engine, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [engine, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (result.status !== 0) {
    throw new Error([
      `Engine command failed: node ${args.join(' ')}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }

  return result;
}

function renderMarkdown(viewer, markdownPath, htmlPath) {
  const result = spawnSync(process.execPath, [viewer, markdownPath, htmlPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error([
      `Markdown viewer failed: node ${path.relative(repoRoot, viewer)} ${path.relative(repoRoot, markdownPath)}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }

  process.stdout.write(result.stdout);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function printReport(catalog, ruleResults, qualityScore, quickchart) {
  const rules = ruleResults.rules ?? [];
  const counts = rules.reduce((acc, rule) => {
    const key = String(rule.status ?? 'unknown').toLowerCase();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const unsupported = rules.filter((rule) => rule.status === 'notImplemented').map((rule) => rule.ruleId);
  const incompleteDimensions = (qualityScore.dimensions ?? []).filter((dimension) => dimension.status === 'incomplete').map((dimension) => dimension.label);

  console.log('CALinter local test report');
  console.log('Rules: .calinter/archi-rules.yml');
  console.log('Quality: .calinter/archi-quality.yml');
  console.log(`Catalog source: ${catalog?.metadata?.source ?? 'unknown'}`);
  console.log(`Catalog model: ${catalog?.metadata?.modelName ?? 'n/a'} (${catalog?.metadata?.modelId ?? 'n/a'})`);
  console.log(`Dimensions: ${(qualityScore.dimensions ?? []).map((dimension) => dimension.label).join(', ')}`);
  console.log(`Rule results: pass=${counts.pass ?? 0}, warning=${counts.warning ?? 0}, incomplete=${counts.notimplemented ?? 0}`);
  console.log(`Overall score: ${formatValue(qualityScore.overallScore)} / status=${qualityScore.status} / partial=${qualityScore.partial ? 'yes' : 'no'}`);
  console.log(`Quality status: ${qualityScore.status} (${qualityScore.partial ? 'partial' : 'complete'})`);
  console.log(`Radar: ${quickchart.partial ? 'partial' : 'complete'} ${quickchart.omittedDimensions?.length ? `omitted=${quickchart.omittedDimensions.join(', ')}` : ''}`.trim());

  console.log('');
  console.log('Dimensions detail:');
  for (const dimension of qualityScore.dimensions ?? []) {
    console.log(`- ${dimension.label} [${dimension.id}] target=${formatValue(dimension.target)} score=${formatValue(dimension.score)} status=${dimension.status} weightTotal=${formatValue(dimension.weightTotal)} includedRules=${formatValue(dimension.includedRules)}`);
    for (const rule of dimension.rules ?? []) {
      console.log(`  - ${rule.ruleId} status=${rule.status} score=${formatValue(rule.score)} weight=${formatValue(rule.weight)} includeInQualityScore=${rule.includeInQualityScore ? 'yes' : 'no'}`);
    }
  }

  console.log('');
  console.log('Rule detail:');
  for (const rule of rules) {
    console.log(`- ${rule.ruleId} [${rule.dimension}] scope=${rule.scope} severity=${rule.severity} status=${rule.status} score=${formatValue(rule.score)} includeInQualityScore=${rule.includeInQualityScore ? 'yes' : 'no'} includeInRadar=${rule.includeInRadar ? 'yes' : 'no'} evaluated=${formatValue(rule.evaluated)} passed=${formatValue(rule.passed)} failed=${formatValue(rule.failed)} findings=${formatValue((rule.findings ?? []).length)}`);
    if (rule.reason) {
      console.log(`  reason=${rule.reason}`);
    }
    for (const finding of rule.findings ?? []) {
      console.log(`  finding=${finding.id ?? 'n/a'} record=${finding.recordId ?? 'n/a'} message=${finding.message ?? 'n/a'}`);
    }
  }

  if (unsupported.length > 0) {
    console.log(`Not implemented: ${unsupported.join(', ')}`);
  }

  if (incompleteDimensions.length > 0) {
    console.log(`Incomplete dimensions: ${incompleteDimensions.join(', ')}`);
  }

  console.log('');
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return 'n/a';
  }

  return String(value);
}
