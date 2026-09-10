/**
 * Join class names, dropping anything falsy.
 *
 * CSS Module lookups are typed `string | undefined` under
 * `noUncheckedIndexedAccess`, so this keeps that strictness without scattering
 * non-null assertions through the components.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}
