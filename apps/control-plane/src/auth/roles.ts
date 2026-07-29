import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

/**
 * Role-based access control (ADR D18: streamer = read-only panel). Operator roles
 * are `admin` (full control) and `streamer` (read-only + a streamer key). The
 * canonical role tuple lives here so decorators, the guard, and the users module's
 * zod validation share one source of truth.
 */
export const ROLES = ["admin", "streamer"] as const;
export type Role = (typeof ROLES)[number];

/** Metadata key under which @Roles(...) stores a route's required roles. */
export const ROLES_KEY = "roles";

/**
 * Mark a controller or handler as requiring one of the given roles, e.g.
 * `@Roles("admin")` on a mutating endpoint. Routes with no @Roles metadata are
 * left open to any authenticated session (reads stay any-session).
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Enforces @Roles metadata against the user the global AuthGuard attaches to the
 * request (`req.user`, carrying its better-auth `role`). Applied per-controller via
 * `@UseGuards(RolesGuard)` so @Public routes and the internal-token flow are
 * untouched. It is a deliberate no-op when a route carries no @Roles metadata, so
 * reads pass through and the same guard is safe if ever registered globally.
 *
 * Guard ordering: NestJS runs global guards (AuthGuard) before controller-level
 * guards, so `req.user` is already populated when this runs. Deny → 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No role requirement on this route → any authenticated session may proceed.
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    const role = req.user?.role;
    if (role && (required as readonly string[]).includes(role)) return true;
    throw new ForbiddenException();
  }
}
