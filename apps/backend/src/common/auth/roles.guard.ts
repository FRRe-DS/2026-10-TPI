import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';
import { AppRole, AuthenticatedIdentity } from './auth.types';

/**
 * Guard global de autorización basada en roles (RBAC).
 *
 * Responsabilidad única: verificar que la identidad YA autenticada (`request.user`)
 * posea al menos uno de los roles declarados mediante `@Roles(...)`.
 * Nunca otorga acceso si el token carece de roles válidos.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request?.user as AuthenticatedIdentity | undefined;

    if (!user || !user.authenticated) {
      throw new UnauthorizedException('Autenticación requerida para acceder a este recurso.');
    }

    const userRoles = Array.isArray(user.roles)
      ? user.roles.map((r) => String(r).toUpperCase())
      : [];

    if (userRoles.length === 0) {
      throw new ForbiddenException(
        'El token JWT no contiene un rol válido para realizar esta operación.',
      );
    }

    const normalizedRequired = requiredRoles.map((r) => r.toUpperCase());
    const hasRole = normalizedRequired.some((allowed) => userRoles.includes(allowed));
    if (!hasRole) {
      throw new ForbiddenException(
        `Sin permiso para esta operación. Roles admitidos: ${normalizedRequired.join(', ')}.`,
      );
    }

    return true;
  }
}
