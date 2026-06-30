import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYamlFile } from './infra/yaml.mjs';

const SUPPORTED_SCOPES = new Set(['collection', 'each']);
const SUPPORTED_OPERATORS = new Set([
  'containsAll',
  'regex',
  'greaterThan',
  'lessThanOrEqual',
  'percentageLessThanOrEqual',
]);

export function generateDesignReports(repoRoot) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const rulesPath = path.join(root, '.calinter', 'archi-rules.yml');
  const qualityPath = path.join(root, '.calinter', 'archi-quality.yml');
  const catalogPath = path.join(root, 'reports', 'catalog.json');
  const ruleResultsPath = path.join(root, 'reports', 'rule-results.json');
  const qualityScorePath = path.join(root, 'reports', 'quality-score.json');
  const quickchartPath = path.join(root, 'reports', 'quickchart-radar.json');

  const rulesConfig = loadYamlFile(rulesPath);
  const qualityConfig = loadYamlFile(qualityPath);
  const catalog = readJsonFile(catalogPath);

  const ruleResults = buildRuleResults(rulesConfig, catalog);
  const qualityScore = buildQualityScore(qualityConfig, ruleResults);
  const quickchart = buildQuickchartRadar(qualityScore);
  const contractCheck = buildContractConsistencyCheck({
    rulesConfig,
    qualityConfig,
    catalog,
    ruleResults,
    qualityScore,
    quickchart,
  });
  const allRuleResults = [...ruleResults, contractCheck.result];
  const finalQualityScore = buildQualityScore(qualityConfig, allRuleResults);
  const finalQuickchart = buildQuickchartRadar(finalQualityScore);

  writeJsonFile(ruleResultsPath, {
    metadata: {
      source: catalog.metadata?.source ?? 'artifact/source/design.archimate',
      generatedAt: new Date().toISOString(),
    },
    rules: allRuleResults,
  });

  writeJsonFile(qualityScorePath, finalQualityScore);
  writeJsonFile(quickchartPath, finalQuickchart);

  if (!contractCheck.ok) {
    throw new Error(`Contrato inconsistente: ${contractCheck.message}`);
  }

  return {
    rulesConfig,
    qualityConfig,
    catalog,
    ruleResults: allRuleResults,
    qualityScore: finalQualityScore,
    quickchart: finalQuickchart,
  };
}

function buildRuleResults(rulesConfig, catalog) {
  const results = [];
  const rules = rulesConfig.rules ?? {};

  for (const [ruleId, rule] of Object.entries(rules)) {
    if (ruleId === 'contract_consistency_check') {
      continue;
    }

    const result = evaluateYamlRule(ruleId, rule, catalog);
    results.push(result);
  }

  return results;
}

function evaluateYamlRule(ruleId, rule, catalog) {
  const scope = String(rule?.scope ?? '').trim();
  const operator = String(rule?.assert?.operator ?? '').trim();
  const dimension = String(rule?.dimension ?? '');
  const severity = String(rule?.severity ?? 'error');

  if (!SUPPORTED_SCOPES.has(scope) || !SUPPORTED_OPERATORS.has(operator)) {
    return {
      ruleId,
      dimension,
      severity,
      scope,
      includeInQualityScore: false,
      includeInRadar: false,
      status: 'notImplemented',
      score: null,
      evaluated: 0,
      passed: 0,
      failed: 0,
      findings: [],
      evidence: [],
      reason: 'unsupported-scope-or-operator',
    };
  }

  if (operator === 'percentageLessThanOrEqual') {
    return evaluatePercentageRule(ruleId, rule, catalog);
  }

  const items = selectItems(rule.source, catalog);
  const filtered = applyFilter(items, rule.source?.filter);

  if (scope === 'collection') {
    return evaluateCollectionRule(ruleId, rule, filtered, operator);
  }

  return evaluateEachRule(ruleId, rule, filtered, operator);
}

function evaluateCollectionRule(ruleId, rule, items, operator) {
  const field = rule.assert?.field ?? 'name';
  const values = items.map((item) => readValue(item, field));
  const target = rule.assert?.value;
  const targets = rule.assert?.values ?? [];

  switch (operator) {
    case 'containsAll': {
      const missing = targets.filter((value) => !values.includes(value));
      const ok = missing.length === 0;
      return {
        ruleId,
        dimension: rule.dimension,
        severity: rule.severity,
        scope: rule.scope,
        status: ok ? 'pass' : severityToStatus(rule.severity),
        score: ok ? passScore(rule) : failScore(rule),
        evaluated: values.length,
        passed: ok ? values.length : values.length - missing.length,
        failed: missing.length,
        findings: ok ? [] : [{ id: `${ruleId}-missing`, message: `Faltan valores: ${missing.join(', ')}` }],
        evidence: [{ collection: rule.source?.collection, recordIds: items.map((item) => item.id).filter(Boolean) }],
      };
    }
    default:
      return unsupported(ruleId, rule);
  }
}

function evaluateEachRule(ruleId, rule, items, operator) {
  const field = rule.assert?.field ?? 'name';
  const threshold = Number(rule.assert?.value);
  const regex = operator === 'regex' ? new RegExp(rule.assert?.pattern ?? '') : null;

  const failures = [];
  let passed = 0;

  for (const item of items) {
    const value = readValue(item, field);
    let ok = true;

    if (operator === 'regex') {
      ok = regex ? regex.test(String(value ?? '')) : false;
    } else if (operator === 'greaterThan') {
      ok = Number(value) > threshold;
    } else if (operator === 'lessThanOrEqual') {
      ok = Number(value) <= threshold;
    }

    if (ok) {
      passed += 1;
      continue;
    }

    failures.push({
      id: `${ruleId}-${item.id ?? failures.length + 1}`,
      collection: item.collection,
      recordId: item.id,
      field,
      value,
      message: rule.failureMessage,
    });
  }

  const failed = failures.length;
  const total = items.length;
  const status = failed === 0 ? 'pass' : severityToStatus(rule.severity);

  return {
    ruleId,
    dimension: rule.dimension,
    severity: rule.severity,
    scope: rule.scope,
    status,
    score: total === 0 ? null : Math.round((passed / total) * 100),
    evaluated: total,
    passed,
    failed,
    findings: failures,
    evidence: [{ collection: rule.source?.collection, recordIds: items.map((item) => item.id).filter(Boolean) }],
  };
}

function evaluatePercentageRule(ruleId, rule, catalog) {
  const collection = selectItems(rule.source, catalog);
  const numerator = collection.filter((item) => matchesCondition(item, rule.metric?.numerator));
  const denominator = rule.metric?.denominator?.count === 'all' ? collection.length : collection.length;
  const ratio = denominator > 0 ? (numerator.length / denominator) * 100 : 0;
  const threshold = Number(rule.assert?.value ?? rule.assert?.threshold ?? 0);
  const pass = ratio <= threshold;

  return {
    ruleId,
    dimension: rule.dimension,
    severity: rule.severity,
    scope: rule.scope,
    status: pass ? 'pass' : severityToStatus(rule.severity),
    score: Math.max(0, Math.round(100 - ratio)),
    evaluated: denominator,
    passed: numerator.length,
    failed: Math.max(0, denominator - numerator.length),
    findings: pass ? [] : [{ id: `${ruleId}-ratio`, ratio, threshold }],
    evidence: [{ collection: rule.source?.collection, associationCount: numerator.length, totalCount: denominator }],
  };
}

function buildQualityScore(qualityConfig, ruleResults) {
  const dimensions = [];
  const ruleResultsById = new Map(ruleResults.map((result) => [result.ruleId, result]));

  for (const [id, dimension] of Object.entries(qualityConfig.qualityModel?.dimensions ?? {})) {
    const rules = [];
    let weightTotal = 0;
    let weightedScore = 0;
    let hasCriticalFailure = false;
    let includedScores = 0;

    for (const ruleRef of dimension.rules ?? []) {
      const result = ruleResultsById.get(ruleRef.id);
      if (!result) {
        continue;
      }

      const includeInScore = result.includeInQualityScore !== false && result.status !== 'notImplemented';
      const score = includeInScore ? Number(result.score) : null;

      rules.push({
        ruleId: ruleRef.id,
        weight: Number(ruleRef.weight) || 0,
        score,
        status: result.status,
      });

      if (includeInScore && Number.isFinite(score)) {
        const weight = Number(ruleRef.weight) || 0;
        weightTotal += weight;
        weightedScore += score * weight;
        includedScores += 1;
      }

      if (result.status === 'fail' && isCriticalSeverity(result.severity, qualityConfig)) {
        hasCriticalFailure = true;
      }
    }

    const score = weightTotal > 0 ? Math.round(weightedScore / weightTotal) : null;
    const status = hasCriticalFailure ? 'fail' : (score === null ? 'notImplemented' : (score >= Number(dimension.target ?? 0) ? 'pass' : 'warning'));

    dimensions.push({
      id,
      label: dimension.label,
      target: Number(dimension.target) || 0,
      score,
      status,
      weightTotal,
      rules,
    });
  }

  const numericScores = dimensions.map((dimension) => dimension.score).filter((score) => Number.isFinite(score));
  const overallScore = numericScores.length > 0
    ? Math.round(numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length)
    : null;
  const status = dimensions.some((dimension) => dimension.status === 'fail')
    ? 'fail'
    : (dimensions.some((dimension) => dimension.status === 'warning') ? 'warning' : 'pass');

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      version: '0.0.3',
    },
    overallScore,
    status,
    radarOrder: dimensions.map((dimension) => dimension.label),
    dimensions,
  };
}

function buildQuickchartRadar(qualityScore) {
  return {
    type: 'radar',
    data: {
      labels: qualityScore.radarOrder,
      datasets: [
        {
          label: 'Evaluado',
          data: qualityScore.dimensions.map((dimension) => dimension.score),
          backgroundColor: 'rgba(34, 197, 94, 0.20)',
          borderColor: '#22c55e',
          pointBackgroundColor: '#22c55e',
          borderWidth: 2,
        },
        {
          label: 'Objetivo',
          data: qualityScore.dimensions.map((dimension) => dimension.target),
          backgroundColor: 'rgba(156, 163, 175, 0.10)',
          borderColor: '#9ca3af',
          pointBackgroundColor: '#9ca3af',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
        },
        title: {
          display: true,
          text: 'Calidad del diseño',
        },
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            stepSize: 20,
          },
        },
      },
    },
  };
}

function buildContractConsistencyCheck({ rulesConfig, qualityConfig, catalog, ruleResults, qualityScore, quickchart }) {
  const definedRules = new Set(Object.keys(rulesConfig.rules ?? {}));
  const qualityRules = Object.values(qualityConfig.qualityModel?.dimensions ?? {}).flatMap((dimension) => (dimension.rules ?? []).map((rule) => rule.id));
  const resultRuleIds = new Set(ruleResults.map((rule) => rule.ruleId));
  const messages = [];

  for (const ruleId of qualityRules) {
    if (!definedRules.has(ruleId)) {
      messages.push(`quality.yml referencia la regla inexistente '${ruleId}'.`);
    }

    if (!resultRuleIds.has(ruleId)) {
      messages.push(`rule-results.json no incluye la regla '${ruleId}'.`);
    }
  }

  for (const dimension of qualityScore?.dimensions ?? []) {
    for (const rule of dimension.rules ?? []) {
      if (!resultRuleIds.has(rule.ruleId)) {
        messages.push(`quality-score.json usa la regla '${rule.ruleId}' sin resultado en rule-results.json.`);
      }
    }
  }

  if (qualityScore?.radarOrder && quickchart?.data?.labels && JSON.stringify(qualityScore.radarOrder) !== JSON.stringify(quickchart.data.labels)) {
    messages.push('quickchart-radar.json no coincide con quality-score.json en las etiquetas.');
  }

  if (qualityScore?.dimensions && quickchart?.data?.datasets?.[0]?.data) {
    const qualityScores = qualityScore.dimensions.map((dimension) => dimension.score);
    const radarScores = quickchart.data.datasets[0].data;
    if (JSON.stringify(qualityScores) !== JSON.stringify(radarScores)) {
      messages.push('quickchart-radar.json no coincide con quality-score.json en el dataset Evaluado.');
    }
  }

  if (qualityScore?.dimensions && quickchart?.data?.datasets?.[1]?.data) {
    const qualityTargets = qualityScore.dimensions.map((dimension) => dimension.target);
    const radarTargets = quickchart.data.datasets[1].data;
    if (JSON.stringify(qualityTargets) !== JSON.stringify(radarTargets)) {
      messages.push('quickchart-radar.json no coincide con quality-score.json en el dataset Objetivo.');
    }
  }

  const referencesPass = evaluateCatalogReferences(catalog);
  if (!referencesPass.ok) {
    messages.push(referencesPass.message);
  }

  return {
    ok: messages.length === 0,
    message: messages.join(' '),
    result: {
      ruleId: 'contract_consistency_check',
      dimension: 'Gobierno',
      severity: 'error',
      scope: 'system',
      includeInQualityScore: false,
      includeInRadar: false,
      status: messages.length === 0 ? 'pass' : 'fail',
      score: 100,
      evaluated: 5,
      passed: messages.length === 0 ? 5 : 0,
      failed: messages.length === 0 ? 0 : 5,
      findings: messages.length === 0 ? [] : messages.map((message, index) => ({ id: `contract-${index + 1}`, message })),
      evidence: [{ collections: ['rules', 'qualityScore', 'quickchart', 'catalog'] }],
      reason: messages.length === 0 ? undefined : 'contract-inconsistency',
    },
  };
}

function evaluateCatalogReferences(catalog) {
  const elementIds = new Set((catalog.elements ?? []).map((element) => element.id));
  const relationshipIds = new Set((catalog.relationships ?? []).map((relationship) => relationship.id));
  const brokenReferences = [];

  for (const object of catalog.diagramObjects ?? []) {
    if (!elementIds.has(object.elementRef)) {
      brokenReferences.push(`diagramObject:${object.id}->${object.elementRef}`);
    }
  }

  for (const connection of catalog.diagramConnections ?? []) {
    if (!relationshipIds.has(connection.relationshipRef)) {
      brokenReferences.push(`diagramConnection:${connection.id}->${connection.relationshipRef}`);
    }
  }

  for (const relationship of catalog.relationships ?? []) {
    if (!elementIds.has(relationship.source)) {
      brokenReferences.push(`relationship:${relationship.id}.source->${relationship.source}`);
    }

    if (!elementIds.has(relationship.target)) {
      brokenReferences.push(`relationship:${relationship.id}.target->${relationship.target}`);
    }
  }

  if (brokenReferences.length > 0) {
    return { ok: false, message: `catalog.json contiene referencias rotas (${brokenReferences.join(', ')}).` };
  }

  return { ok: true, message: '' };
}

function applyFilter(items, filter) {
  if (!filter) {
    return items;
  }

  return items.filter((item) => matchesCondition(item, filter));
}

function selectItems(source, catalog) {
  const collections = source?.collections ?? (source?.collection ? [source.collection] : []);
  return collections.flatMap((collection) => (catalog[collection] ?? []).map((item) => ({ ...item, collection })));
}

function matchesCondition(item, condition) {
  if (!condition) {
    return true;
  }

  const value = String(readValue(item, condition.field ?? condition.attribute ?? '') ?? '');
  if (condition.notEmpty) {
    return value.trim().length > 0;
  }

  if (condition.equals !== undefined) {
    return value === String(condition.equals);
  }

  if (condition.contains !== undefined) {
    return value.includes(String(condition.contains));
  }

  return true;
}

function readValue(item, field) {
  if (!field) {
    return undefined;
  }

  if (field in item) {
    return item[field];
  }

  if (field.startsWith('attrs.')) {
    return item.attrs?.[field.slice('attrs.'.length)];
  }

  return undefined;
}

function severityToStatus(severity) {
  return String(severity ?? 'error').toLowerCase() === 'warning' ? 'warning' : 'fail';
}

function passScore() {
  return 100;
}

function failScore(rule) {
  return String(rule?.severity ?? 'error').toLowerCase() === 'warning' ? 50 : 0;
}

function unsupported(ruleId, rule) {
  return {
    ruleId,
    dimension: rule?.dimension,
    severity: rule?.severity,
    scope: rule?.scope,
    includeInQualityScore: false,
    includeInRadar: false,
    status: 'notImplemented',
    score: null,
    evaluated: 0,
    passed: 0,
    failed: 0,
    findings: [],
    evidence: [],
    reason: 'unsupported-rule',
  };
}

function isCriticalSeverity(severity, qualityConfig) {
  const critical = qualityConfig.qualityModel?.statusPolicy?.criticalSeverities ?? ['error'];
  return critical.includes(String(severity ?? '').toLowerCase());
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
