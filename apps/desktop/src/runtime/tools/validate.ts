// Small JSON-Schema validator for tool arguments (the subset our tool schemas use).
// Owns: type/required/enum/range/length/items/properties/additionalProperties/anyOf checks
// with short, model-readable error lines ("text: required"). B-080 (live: "unknown property" and "does not match any
// allowed shape" left the agent guessing): an unknown property's line names what that object takes, and an anyOf
// line names the shapes ('to: takes "origin", "all" or an integer 1–10') – an object or list that fits one shape's
// type gets that shape's own lines. coerce: what a model wrote loosely, as the schema means it (a numeric string where
// only a number fits, an enum value in another case), applied by the registry before validate.
// Never: mutates values, fetches $refs, or throws on unknown keywords (ignored).

import type { JsonSchema } from './types.ts';

type Schema = JsonSchema & {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  enum?: unknown[];
  const?: unknown;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  anyOf?: Schema[];
  oneOf?: Schema[];
};

const MAX_ERRORS = 8;
const NUMERIC = /^-?\d+(?:\.\d+)?$/;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

const typesOf = (schema: Schema): string[] => (schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type]);

/** One shape in a few words: its enum values, or "an integer 1–10", "a string", "an object {a, b}". */
function shapeWords(schema: Schema): string[] {
  if (schema.enum) return schema.enum.map((option) => JSON.stringify(option));
  if (schema.const !== undefined) return [JSON.stringify(schema.const)];
  const nested = schema.anyOf ?? schema.oneOf;
  if (nested?.length) return nested.flatMap(shapeWords);
  return typesOf(schema).map((type) => {
    if (type === 'integer' || type === 'number') {
      const range = schema.minimum !== undefined && schema.maximum !== undefined ? ` ${schema.minimum}–${schema.maximum}`
        : schema.minimum !== undefined ? ` ≥ ${schema.minimum}` : schema.maximum !== undefined ? ` ≤ ${schema.maximum}` : '';
      return `${type === 'integer' ? 'an integer' : 'a number'}${range}`;
    }
    if (type === 'object') return schema.properties ? `an object {${Object.keys(schema.properties).join(', ')}}` : 'an object';
    if (type === 'array') return 'a list';
    if (type === 'boolean') return 'true or false';
    return type === 'null' ? 'null' : `a ${type}`;
  });
}

/** "a, b or c" */
function either(words: string[]): string {
  const unique = [...new Set(words)];
  return unique.length > 1 ? `${unique.slice(0, -1).join(', ')} or ${unique.at(-1)}` : unique[0] ?? 'another shape';
}

function check(value: unknown, schema: Schema, path: string, errors: string[]): void {
  if (errors.length >= MAX_ERRORS || !schema || typeof schema !== 'object') return;
  const where = path || 'arguments';

  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives?.length) {
    const tried = alternatives.map((option) => { const inner: string[] = []; check(value, option, path, inner); return inner; });
    if (tried.some((inner) => inner.length === 0)) return;
    // An object or a list whose type fits one shape only: that shape's own lines say what is wrong inside it.
    const structured = typeOf(value) === 'object' || Array.isArray(value);
    const fitting = structured ? alternatives.flatMap((option, index) => (typesOf(option).some((type) => matchesType(value, type)) ? [index] : [])) : [];
    if (fitting.length === 1) errors.push(...tried[fitting[0]].slice(0, MAX_ERRORS - errors.length));
    else errors.push(`${where}: takes ${either(alternatives.flatMap(shapeWords))}`);
    return;
  }

  if (schema.type !== undefined) {
    const types = typesOf(schema);
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${where}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return;
    }
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${where}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((option) => option === value)) {
    errors.push(`${where}: must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${where}: too short (min ${schema.minLength})`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${where}: too long (max ${schema.maxLength})`);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${where}: must be a finite number`);
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${where}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${where}: must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${where}: needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${where}: at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, index) => check(item, schema.items!, `${where}[${index}]`, errors));
  }
  if (typeOf(value) === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) errors.push(`${path ? `${path}.` : ''}${key}: required`);
    }
    const properties = schema.properties ?? {};
    const takes = Object.keys(properties);
    for (const [key, item] of Object.entries(record)) {
      const childPath = path ? `${path}.${key}` : key;
      if (properties[key]) {
        if (item !== undefined) check(item, properties[key], childPath, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${childPath}: unknown property – ${path ? `${path} takes` : 'the tool takes'} ${takes.length ? takes.join(', ') : 'none'}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        check(item, schema.additionalProperties, childPath, errors);
      }
    }
  }
}

/** Returns error lines (empty when valid). `undefined`/`null` args are validated as `{}`. */
export function validate(value: unknown, schema: JsonSchema): string[] {
  const errors: string[] = [];
  check(value ?? {}, schema as Schema, '', errors);
  return errors;
}

const fits = (value: unknown, schema: Schema): boolean => { const errors: string[] = []; check(value, schema, '', errors); return errors.length === 0; };

/**
 * B-080 (live: agents.split_tell to:"2", an effort in capitals): `value` as the schema means it – a numeric string
 * where only a number fits becomes that number, a string that differs from an enum value only in case becomes that
 * value; inside objects, lists and anyOf shapes too. The same value when nothing changes; a copy otherwise.
 */
export function coerce(value: unknown, schema: JsonSchema): unknown {
  const s = schema as Schema;
  if (!s || typeof s !== 'object' || value === undefined || value === null) return value;
  const alternatives = s.anyOf ?? s.oneOf;
  if (alternatives?.length) {
    if (alternatives.some((option) => fits(value, option))) return value;
    for (const option of alternatives) {
      const next = coerce(value, option);
      if (next !== value && fits(next, option)) return next;
    }
    return value;
  }
  if (typeof value === 'string') {
    const types = typesOf(s);
    const text = value.trim();
    if (!types.includes('string') && (types.includes('integer') || types.includes('number')) && NUMERIC.test(text)) {
      const number = Number(text);
      if (Number.isFinite(number) && (types.includes('number') || Number.isInteger(number))) return number;
    }
    if (s.enum && !s.enum.includes(value)) return s.enum.find((option) => typeof option === 'string' && option.toLowerCase() === text.toLowerCase()) ?? value;
    return value;
  }
  if (Array.isArray(value)) {
    if (!s.items) return value;
    const next = value.map((item) => coerce(item, s.items!));
    return next.some((item, index) => item !== value[index]) ? next : value;
  }
  if (typeOf(value) !== 'object') return value;
  const record = value as Record<string, unknown>;
  let next: Record<string, unknown> | undefined;
  for (const [key, item] of Object.entries(record)) {
    const child = s.properties?.[key] ?? (typeof s.additionalProperties === 'object' ? s.additionalProperties : undefined);
    if (!child) continue;
    const changed = coerce(item, child);
    if (changed !== item) (next ??= { ...record })[key] = changed;
  }
  return next ?? value;
}
