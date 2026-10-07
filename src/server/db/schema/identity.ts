import {
  boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tracking, updatedAt } from "./_common";
import { idType, membershipStatus, mfaType, otpPurpose, roleScope, userStatus } from "./enums";

export const users = pgTable("users", {
  id: id(),
  phone: text().notNull(),
  email: text(),
  passwordHash: text(),
  fullName: text(),
  idType: idType(),
  nationalIdEnc: text(), // AES-GCM ciphertext
  nationalIdHash: text(), // keyed hash for exact-match lookup
  birthDate: date(),
  locale: text().default("ar").notNull(),
  numeralStyle: text().default("latn").notNull(), // latn | arab
  calendarPref: text().default("both").notNull(), // hijri | gregorian | both
  status: userStatus().default("active").notNull(),
  isStaff: boolean().default(false).notNull(),
  mfaEnabled: boolean().default(false).notNull(),
  phoneVerifiedAt: timestamp({ withTimezone: true }),
  emailVerifiedAt: timestamp({ withTimezone: true }),
  failedLoginCount: integer().default(0).notNull(),
  lockedUntil: timestamp({ withTimezone: true }),
  lastLoginAt: timestamp({ withTimezone: true }),
  deletionRequestedAt: timestamp({ withTimezone: true }),
  residesInKsa: boolean(),
  ...tracking(),
}, (t) => [
  uniqueIndex("users_phone_uq").on(t.phone),
  uniqueIndex("users_email_uq").on(t.email),
  index("users_nid_hash_idx").on(t.nationalIdHash),
]);

export const roles = pgTable("roles", {
  id: id(),
  key: text().notNull(),
  nameAr: text().notNull(),
  scope: roleScope().notNull(),
  description: text(),
  isSystem: boolean().default(true).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("roles_key_uq").on(t.key)]);

export const permissions = pgTable("permissions", {
  id: id(),
  key: text().notNull(),
  nameAr: text().notNull(),
  domain: text().notNull(),
}, (t) => [uniqueIndex("permissions_key_uq").on(t.key)]);

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid().notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid().notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]);

/** Global (staff / platform) role grants. */
export const userRoles = pgTable("user_roles", {
  userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid().notNull().references(() => roles.id, { onDelete: "cascade" }),
  grantedBy: uuid(),
  grantedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

/** Per-waqf role: the core of the access model (permissions are granted per waqf, not per account). */
export const waqfMemberships = pgTable("waqf_memberships", {
  id: id(),
  waqfId: uuid().notNull(),
  userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
  roleKey: text().notNull(),
  isIndependent: boolean().default(false).notNull(),
  status: membershipStatus().default("active").notNull(),
  startsAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  endsAt: timestamp({ withTimezone: true }),
  invitedBy: uuid(),
  scope: jsonb().$type<{ permissions?: string[]; documentTypes?: string[] }>(),
  ...tracking(),
}, (t) => [
  index("wm_waqf_idx").on(t.waqfId),
  index("wm_user_idx").on(t.userId),
  uniqueIndex("wm_unique_active").on(t.waqfId, t.userId, t.roleKey),
]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text().notNull(),
  mfaVerified: boolean().default(false).notNull(),
  ip: text(),
  userAgent: text(),
  deviceId: uuid(),
  createdAt: createdAt(),
  lastSeenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  idleExpiresAt: timestamp({ withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp({ withTimezone: true }).notNull(),
  revokedAt: timestamp({ withTimezone: true }),
  revokeReason: text(),
}, (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

export const devices = pgTable("devices", {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text(),
  fingerprintHash: text().notNull(),
  trusted: boolean().default(false).notNull(),
  firstSeenAt: createdAt(),
  lastSeenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("devices_user_idx").on(t.userId)]);

export const mfaFactors = pgTable("mfa_factors", {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
  type: mfaType().notNull(),
  secretEnc: text().notNull(),
  label: text(),
  verifiedAt: timestamp({ withTimezone: true }),
  lastUsedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
});

export const recoveryCodes = pgTable("recovery_codes", {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text().notNull(),
  usedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
});

export const otpChallenges = pgTable("otp_challenges", {
  id: id(),
  target: text().notNull(),
  purpose: otpPurpose().notNull(),
  codeHash: text().notNull(),
  attempts: integer().default(0).notNull(),
  maxAttempts: integer().default(5).notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  consumedAt: timestamp({ withTimezone: true }),
  ip: text(),
  context: jsonb().$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index("otp_target_idx").on(t.target, t.purpose)]);

export const invitations = pgTable("invitations", {
  id: id(),
  waqfId: uuid().notNull(),
  phone: text().notNull(),
  roleKey: text().notNull(),
  tokenHash: text().notNull(),
  invitedBy: uuid().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  acceptedAt: timestamp({ withTimezone: true }),
  acceptedBy: uuid(),
  revokedAt: timestamp({ withTimezone: true }),
  scope: jsonb().$type<Record<string, unknown>>(),
  note: text(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("inv_token_uq").on(t.tokenHash), index("inv_waqf_idx").on(t.waqfId)]);

/** Powers of attorney (وكالات): scope-limited and time-limited. */
export const delegations = pgTable("delegations", {
  id: id(),
  waqfId: uuid().notNull(),
  agentUserId: uuid().notNull().references(() => users.id),
  principalUserId: uuid(),
  principalName: text(),
  powerOfAttorneyNo: text(),
  documentId: uuid(),
  scope: jsonb().$type<string[]>().notNull(), // permission keys allowed
  includesDonations: boolean().default(false).notNull(),
  includesAssetDisposal: boolean().default(false).notNull(),
  validFrom: date().notNull(),
  validTo: date().notNull(),
  status: text().default("pending_review").notNull(), // pending_review | active | expired | revoked
  verifiedBy: uuid(),
  verifiedAt: timestamp({ withTimezone: true }),
  ...tracking(),
}, (t) => [index("deleg_waqf_idx").on(t.waqfId), index("deleg_agent_idx").on(t.agentUserId)]);

export const rateLimits = pgTable("rate_limits", {
  key: text().notNull(),
  windowStart: timestamp({ withTimezone: true }).notNull(),
  count: integer().default(0).notNull(),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] })]);

export const breakGlassAccess = pgTable("break_glass_access", {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  waqfId: uuid().notNull(),
  reason: text().notNull(),
  status: text().default("requested").notNull(), // requested | approved | rejected | expired
  approvedBy: uuid(),
  approvedAt: timestamp({ withTimezone: true }),
  expiresAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
