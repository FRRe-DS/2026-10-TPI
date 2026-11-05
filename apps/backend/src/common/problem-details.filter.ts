import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Títulos en español definidos por el esquema ProblemaGenerico del contrato OpenAPI 3.1
 * coordinado definitivo (RFC 9457).
 */
const GENERIC_STATUS_TITLES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Solicitud inválida',
  [HttpStatus.UNAUTHORIZED]: 'No autenticado',
  [HttpStatus.FORBIDDEN]: 'Sin permiso',
  [HttpStatus.NOT_FOUND]: 'No encontrado',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'Método no permitido',
  [HttpStatus.GONE]: 'Recurso expirado o ya utilizado',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Cuerpo demasiado grande',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Tipo de contenido no soportado',
  [HttpStatus.BAD_GATEWAY]: 'Error en proveedor externo',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Servicio no disponible',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Error interno',
};

const DOMAIN_DEFAULT_TITLES: Record<number, string> = {
  [HttpStatus.CONFLICT]: 'El estado del recurso no admite la operación',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Regla de negocio no cumplida',
};

const DOMAIN_DEFAULT_TYPES: Record<number, string> = {
  [HttpStatus.CONFLICT]: '/errores/conflicto-estado',
  [HttpStatus.UNPROCESSABLE_ENTITY]: '/errores/regla-de-negocio',
};

export function resolveRequestId(rawHeader?: string | string[]): string {
  const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (candidate && VALID_REQUEST_ID.test(candidate)) {
    return candidate;
  }
  return crypto.randomUUID();
}

/**
 * Filtro global de excepciones compatible con RFC 9457 (application/problem+json)
 * según el contrato coordinado definitivo de M8 (G7 + G10):
 * - Errores genéricos (400, 401, 403, 404, 405, 413, 415, 500, 503): type = "about:blank"
 *   y title en español exacto según ProblemaGenerico.
 * - Errores de dominio (409, 422): type propio (ej. "/errores/qr-usado") y title descriptivo.
 * - Conserva campos de retrocompatibilidad (statusCode, message, error, timestamp, path).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const rawStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof (exception as any)?.status === 'number'
          ? (exception as any).status
          : typeof (exception as any)?.statusCode === 'number'
            ? (exception as any).statusCode
            : (exception as any)?.type === 'entity.too.large'
              ? HttpStatus.PAYLOAD_TOO_LARGE
              : HttpStatus.INTERNAL_SERVER_ERROR;

    const status =
      rawStatus >= 400 && rawStatus <= 599
        ? rawStatus
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let detail = 'Ocurrió un error inesperado al procesar la solicitud.';
    let errorName = HttpStatus[status] || 'Internal Server Error';
    let customType: string | undefined;
    let customTitle: string | undefined;
    let allowHeader: string | undefined;

    if (typeof exceptionResponse === 'string') {
      detail = exceptionResponse;
    } else if (exceptionResponse && typeof exceptionResponse === 'object') {
      const resObj = exceptionResponse as Record<string, unknown>;
      if (Array.isArray(resObj.message)) {
        detail = resObj.message.join('; ');
      } else if (typeof resObj.message === 'string') {
        detail = resObj.message;
      } else if (typeof resObj.detail === 'string') {
        detail = resObj.detail;
      }
      if (typeof resObj.error === 'string') {
        errorName = resObj.error;
      }
      if (typeof resObj.type === 'string' && resObj.type.trim()) {
        customType = resObj.type.trim();
      }
      if (typeof resObj.title === 'string' && resObj.title.trim()) {
        customTitle = resObj.title.trim();
      }
      if (typeof resObj.allow === 'string' && resObj.allow.trim()) {
        allowHeader = resObj.allow.trim();
      }
    } else if (
      status !== HttpStatus.INTERNAL_SERVER_ERROR &&
      exception instanceof Error &&
      exception.message
    ) {
      detail = exception.message;
    }

    const isDomainError =
      status === HttpStatus.CONFLICT ||
      status === HttpStatus.UNPROCESSABLE_ENTITY;

    const type = isDomainError
      ? (customType ?? DOMAIN_DEFAULT_TYPES[status])
      : (customType ?? 'about:blank');

    const title = isDomainError
      ? (customTitle ?? DOMAIN_DEFAULT_TITLES[status])
      : (customTitle ?? GENERIC_STATUS_TITLES[status] ?? 'Error interno');

    const requestId = resolveRequestId(request?.headers?.['x-request-id']);
    const instance = request?.originalUrl || request?.url || '/';

    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Content-Type', 'application/problem+json');

    if (status === HttpStatus.METHOD_NOT_ALLOWED && allowHeader) {
      response.setHeader('Allow', allowHeader);
    }
    if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      response.setHeader('Retry-After', '5');
    }

    response.status(status).json({
      type,
      title,
      status,
      detail,
      instance,
      statusCode: status,
      message: detail,
      error: errorName,
      timestamp: new Date().toISOString(),
      path: instance,
    });
  }
}
