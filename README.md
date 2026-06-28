# CALinter

[English](README.md) | [Español](README.es.md)

CALinter is a reusable governance linter for ArchiMate design repositories.

It helps teams enforce modeling conventions and structural compliance early in the delivery flow. The linter is designed to be consumed through GitHub Actions and kept close to the design repository it validates.

## Why CALinter

- Detects modeling issues before they reach reviewers or downstream consumers.
- Keeps governance rules centralized and reusable.
- Supports a clear contract between the governance repo and design repos.
- Produces machine-readable validation output and a human-readable summary.

## Supported Model Formats

CALinter currently supports ArchiMate models exported from Archi in XML form:

- `artifact/source/design.archimate`
- `artifact/exchange/design.openexchange.xml`

## Adoption

To adopt this approach, fork both repositories into your organization:

1. CALinter: `https://github.com/ContinuousArchitecture/CALinter/fork`
2. Example solution building block: `https://github.com/ContinuousArchitecture/sbb-9999-example/fork`

Use the forked `sbb-9999-example` repository as the starting point for your design repository.

## Rule Authoring

Rules are defined as YAML files under `rules/` and are listed in `rules/manifest.yaml`.

Each rule set describes:

- `schemaVersion`: rule contract version.
- `tool`: the modeling tool.
- `format`: input format.
- `dialect`: modeling dialect.
- `target`: the expected file or location.
- `checks`: the validations to execute.

Typical check types include:

- `path`
- `single-visible-file`
- `file-not-empty`
- `xml-root`
- `text-contains`
- `xml-name-regex`
- `xml-name-not-contains`

## Rule Example

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
