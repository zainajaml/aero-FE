/** Splits a display name into first/last parts, ignoring values that look like email addresses. */
export function splitFullName(fullName: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first || first.includes("@")) return { firstName: null, lastName: null };
  return { firstName: first, lastName: parts.slice(1).join(" ") || null };
}

export function displayNameFromEmail(email: string): string {
  return email.split("@")[0] ?? email;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  account_admin: "Account Admin",
  admin: "Project Admin",
  developer: "Developer",
  team: "Team",
  viewer: "Viewer",
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

type NameParts = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
} | null;

/** "First Last", else full name, else email local part, else the fallback (ports formatDisplayName). */
export function displayName(profile: NameParts, fallback: string): string {
  const joined = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();
  return joined || profile?.fullName?.trim() || profile?.email?.split("@")[0] || fallback;
}
