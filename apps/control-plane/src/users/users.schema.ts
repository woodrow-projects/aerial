import { z } from "zod";
import { ROLES } from "../auth/roles";

/**
 * Body for `PATCH /api/users/:id/role`. The role enum is sourced from the canonical
 * ROLES tuple (auth/roles) so validation and the RBAC guard share one definition.
 * Kept local to this module until the SPA needs the type.
 */
export const updateRoleSchema = z.object({
  role: z.enum(ROLES),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
