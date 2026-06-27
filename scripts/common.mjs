import fs from 'node:fs';
import path from 'node:path';

// Componentes compartidos para los scripts de gobernanza.
// Mantiene fuera del engine la lectura de argumentos, el estado común y el I/O.
export function getArg(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

export function resolveArgPath(name, fallback) {
  return path.resolve(getArg(name, fallback));
}

export function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function createValidationState() {
  return {
    status: 'PASS',
    observations: [],
    checks: [],
  };
}

export function failValidation(state, message) {
  state.status = 'FAIL';
  state.observations.push(message);
}

export function addValidationCheck(state, id, status, detail = undefined, message = undefined) {
  state.checks.push({ id, status, detail, message });
}

export function computeValidationStatus(state) {
  return state.status === 'PASS' && state.checks.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL';
}

export function createValidationReport(base, state) {
  return {
    ...base,
    status: computeValidationStatus(state),
    checks: state.checks,
    observations: state.observations,
  };
}

export function writeJsonReport(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function readJsonEnv(name, fallback = '{}') {
  return JSON.parse(process.env[name] ?? fallback);
}
