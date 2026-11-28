import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AppRole, AuthenticatedIdentity } from './auth.types';

export const IS_PUBLIC_KEY = 'm8:auth:isPublic';
export const ROLES_KEY = 'm8:auth:roles';

/**
 * Marca un endpoint o controlador como público (sin exigir JWT Bearer).
 * Debe aplicarse únicamente a endpoints declarados públicos en el contrato (ej. GET /health).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Declara los roles admitidos para una operación según el contrato OpenAPI de M8.
 */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Inyecta la identidad criptográficamente verificada por JwtAuthGuard (`request.user`).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedIdentity | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request?.user as AuthenticatedIdentity | undefined;
  },
);
