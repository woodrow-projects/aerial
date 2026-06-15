import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import { auth } from "./auth";

/** Mark a controller/route as not requiring an operator session (e.g. /internal,
 *  the future public analytics beacon). The route keeps any of its own guards. */
export const IS_PUBLIC = "isPublic";
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * Global guard: every Nest controller route requires a valid better-auth session
 * unless marked @Public(). The raw Fastify /api/auth/* route, the static SPA, and
 * Swagger are not Nest controllers, so they are not affected.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<{ headers: IncomingHttpHeaders }>();
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new UnauthorizedException();

    Object.assign(req, { user: session.user, session: session.session });
    return true;
  }
}
