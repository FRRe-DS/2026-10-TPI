import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProblemDetailsFilter, resolveRequestId } from './problem-details.filter';

describe('ProblemDetailsFilter (RFC 9457 - Contrato Coordinado Definitivo M8)', () => {
  let filter: ProblemDetailsFilter;

  beforeEach(() => {
    filter = new ProblemDetailsFilter();
  });

  const createMockHost = (url = '/api/v1/tickets', requestIdHeader?: string) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const setHeader = jest.fn();

    const response = {
      status,
      setHeader,
    };

    const request = {
      url,
      originalUrl: url,
      headers: requestIdHeader ? { 'x-request-id': requestIdHeader } : {},
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    return { host, status, json, setHeader };
  };

  it('debe formatear errores genéricos (404) con type about:blank y title en español según ProblemaGenerico', () => {
    const { host, status, json, setHeader } = createMockHost(
      '/api/v1/comprobantes/inexistente/pdf',
      'req-corr-123',
    );

    filter.catch(new NotFoundException('Comprobante no encontrado'), host);

    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-corr-123');
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'about:blank',
        title: 'No encontrado',
        status: 404,
        detail: 'Comprobante no encontrado',
        instance: '/api/v1/comprobantes/inexistente/pdf',
        statusCode: 404,
        message: 'Comprobante no encontrado',
        path: '/api/v1/comprobantes/inexistente/pdf',
      }),
    );
  });

  it('debe formatear errores de dominio (409 y 422) con su propio type y title', () => {
    const { host, status, json } = createMockHost('/api/v1/qr/validaciones');

    filter.catch(
      new ConflictException({
        type: '/errores/qr-usado',
        title: 'El QR ya fue usado',
        detail: 'El código QR ya fue consumido previamente.',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: '/errores/qr-usado',
        title: 'El QR ya fue usado',
        status: 409,
        detail: 'El código QR ya fue consumido previamente.',
        instance: '/api/v1/qr/validaciones',
      }),
    );

    const { host: host422, json: json422 } = createMockHost('/api/v1/eventos');
    filter.catch(new UnprocessableEntityException('Mismo eventoId con distinto cuerpo'), host422);

    expect(json422).toHaveBeenCalledWith(
      expect.objectContaining({
        type: '/errores/regla-de-negocio',
        title: 'Regla de negocio no cumplida',
        status: 422,
        detail: 'Mismo eventoId con distinto cuerpo',
      }),
    );
  });

  it('debe generar un nuevo X-Request-Id válido cuando el encabezado entrante está ausente o es inválido', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(resolveRequestId('invalido con espacios $$$')).toMatch(/^[0-9a-f-]{36}$/i);
    expect(resolveRequestId('valid_id-123.abc')).toBe('valid_id-123.abc');
  });

  it('debe concatenar múltiples mensajes de validación en detail y message con title Solicitud inválida', () => {
    const { host, json } = createMockHost('/api/v1/tickets');
    const exception = new BadRequestException(['El título es corto', 'Falta referencia']);

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'about:blank',
        title: 'Solicitud inválida',
        status: 400,
        detail: 'El título es corto; Falta referencia',
        message: 'El título es corto; Falta referencia',
      }),
    );
  });
});
