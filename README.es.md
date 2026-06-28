# CALinter

[English](README.md) | [Español](README.es.md)

CALinter es un linter de gobernanza reutilizable para repositorios de diseño ArchiMate.

Ayuda a los equipos a aplicar convenciones de modelado y cumplimiento estructural desde etapas tempranas del flujo de entrega. El linter está diseñado para consumirse desde GitHub Actions y mantenerse cerca del repositorio de diseño que valida.

## Por Qué CALinter

- Detecta problemas de modelado antes de que lleguen a revisión o a consumidores posteriores.
- Mantiene las reglas de gobernanza centralizadas y reutilizables.
- Ofrece un contrato claro entre el repositorio de gobernanza y los repositorios de diseño.
- Produce una salida de validación legible por máquina y un resumen legible por personas.

## Formatos Compatibles

CALinter soporta actualmente modelos ArchiMate exportados desde Archi en formato XML:

- `artifact/source/design.archimate`
- `artifact/exchange/design.openexchange.xml`

## Adopción

Para adoptar este enfoque, haz fork de ambos repositorios dentro de tu organización:

1. CALinter: `https://github.com/ContinuousArchitecture/CALinter/fork`
2. Repositorio de ejemplo: `https://github.com/ContinuousArchitecture/sbb-9999-example/fork`

Usa el fork de `sbb-9999-example` como punto de partida para tu repositorio de diseño.

## Autoría de Reglas

Las reglas se definen como archivos YAML bajo `rules/` y se listan en `rules/manifest.yaml`.

Cada conjunto de reglas describe:

- `schemaVersion`: versión del contrato de la regla.
- `tool`: herramienta de modelado.
- `format`: formato de entrada.
- `dialect`: dialecto de modelado.
- `target`: archivo o ubicación esperada.
- `checks`: validaciones a ejecutar.

Los tipos de check habituales incluyen:

- `path`
- `single-visible-file`
- `file-not-empty`
- `xml-root`
- `text-contains`
- `xml-name-regex`
- `xml-name-not-contains`

## Ejemplo de Regla

```yaml
schemaVersion: 1
title: Example rule
tool: archi
format: xml
dialect: archimate
target:
  path: artifact/source/design.archimate
  mode: single-file
checks:
  - id: archimate-root
    type: xml-root
    path: artifact/source/design.archimate
    root: archimate:model
```
