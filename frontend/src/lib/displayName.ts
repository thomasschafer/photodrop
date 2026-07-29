/**
 * Turn what was typed into a display-name field into the value the API expects.
 *
 * A per-group display name is an optional override, so an empty field is not an
 * error — it means "no override", which the API spells as null and answers by
 * restoring the member's canonical name. Shared by the member's own profile
 * surface and the admin's members list so both treat an emptied field the same
 * way.
 */
export function displayNameFromInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
