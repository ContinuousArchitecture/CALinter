# CALinter

Repositorio del linter `CALinter`.

Este proyecto centraliza las reglas de cumplimiento para modelos ArchiMate exportados desde Archi y expone un reusable workflow de cumplimiento. Cada repositorio de diseño debe hacer fork de este repositorio en su propia organización y consumir el workflow reutilizable desde ahí.

## Cómo usarlo

1. Hacer fork de este repositorio en tu organización.
2. Crear o adaptar el repositorio de diseño con el scaffolding esperado.
3. Referenciar el reusable workflow desde el repo de diseño.
4. Ejecutar el workflow en `push` o `pull_request`.

## Scaffolding esperado del repo de diseño

El repositorio de diseño debe exponer esta estructura mínima:

```text
.
├─ artifact/
│  ├─ source/
│  │  └─ design.archimate
│  └─ exchange/
│     └─ design.openexchange.xml
└─ .github/
   └─ workflows/
      └─ ci.yml
```

## Ejemplo de workflow del repo de diseño

```yaml
name: Continuous Architecture CI

on:
  pull_request:
    branches:
      - main
    paths:
      - "artifact/**"
      - ".github/workflows/**"

  push:
    branches:
      - main
    paths:
      - "artifact/**"
      - ".github/workflows/**"

jobs:
  execute_rules:
    name: Validar cumplimiento
    uses: ContinuousArchitecture/CALinter/.github/workflows/compliance.yml@main
```

## Reglas actuales

- `archi-consistency-rule`: consistencia e integridad básica del archivo `.archimate`.
- `archi-style-rule`: convención de nombres y estilo para elementos y vistas.

## Qué incluye el repositorio

- `src/engine.mjs`: orquestador del motor.
- `src/checks/`: estrategias de validación por tipo de regla.
- `src/core/`: schemas y registro declarativo de reglas.
- `src/infra/`: utilidades de FS, YAML, XML y argumentos.
- `rules/`: manifiesto y reglas YAML.
- `.github/workflows/compliance.yml`: reusable workflow de cumplimiento.

## Requisitos

- Node.js 20 o superior.
- `npm`.

## Uso local

```bash
npm ci
npm run validate
```

O directamente:

```bash
node src/engine.mjs --mode validate --repo-root . --manifest rules/manifest.yaml
```
