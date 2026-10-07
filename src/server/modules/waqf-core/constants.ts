import { ROLES, WAQF_ROLE_KEYS } from "../../authz/catalog";

/** Roles a user may claim when registering an existing waqf. */
export const REGISTER_ROLES = ["founder", "nazir", "board_chair", "delegated_manager", "executive"] as const;
/** Roles that can be granted by invitation (agents go through powers of attorney). */
export const INVITABLE_ROLES = WAQF_ROLE_KEYS.filter((r) => r !== "agent") as [string, ...string[]];
/** The most an agent can ever be given; the power of attorney narrows it. */
export const AGENT_CEILING = ROLES.agent.permissions as string[];
/** Roles a waqf must never lose its last active holder of. */
export const PROTECTED_ROLES = ["nazir", "founder", "board_chair"];
