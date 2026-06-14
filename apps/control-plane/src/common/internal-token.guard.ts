import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

/**
 * Guards the /internal/* hooks called by Liquidsoap. Fails closed: if no token
 * is configured, all internal requests are rejected (ADR D10). Constant-time
 * comparison avoids leaking the token via timing.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = env.internal.token;
    if (!expected) throw new UnauthorizedException("internal hooks disabled (no token configured)");

    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const provided = req.headers["x-internal-token"] ?? "";

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("invalid internal token");
    }
    return true;
  }
}
