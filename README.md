# ci-architecture-governance

Repositorio central de gobernanza para activos arquitectónicos.

## Filosofía

- Un motor declarativo ejecuta validaciones.
- Los desarrolladores agregan reglas JSON, no scripts por cada regla.
- El workflow reutilizable solo orquesta el engine.

## Estructura

- `rules/`: manifest y reglas declarativas.
- `scripts/`: engine, componentes compartidos y render del resumen.
- `.github/workflows/validate.yml`: workflow reusable para el repo llamador.
