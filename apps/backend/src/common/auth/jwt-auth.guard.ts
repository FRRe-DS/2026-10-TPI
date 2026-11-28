import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { JwtAuthService } from './jwt-auth.service';

/**
 * Guard global de autenticación JWT.
 *
 * Responsabilidad única: validar la identidad del llamante (firma, exp, nbf, iss, aud)
 * mediante JwtAuthService y adjuntar `request.user`.
 * Las rutas explícitamente decoradas con `@Public()` quedan exentas.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtAuthService: JwtAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request?.headers?.authorization as string | undefined;
    const identity = await this.jwtAuthService.verifyAuthorizationHeader(authHeader);
    request.user = identity;
    return true;
  }
}
