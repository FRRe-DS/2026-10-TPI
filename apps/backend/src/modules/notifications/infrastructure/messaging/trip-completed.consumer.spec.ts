import { ConsumeMessage, Channel, ChannelModel } from 'amqplib';
import * as amqp from 'amqplib';
import { RegisterReceiptUseCase } from '../../../documents/application/use-cases/register-receipt.use-case';
import { NotificationsService } from '../../application/notifications.service';
import { TripCompletedConsumer } from './trip-completed.consumer';

describe('TripCompletedConsumer', () => {
  const rabbitVariables = [
    'RABBITMQ_URL',
    'RABBITMQ_QUEUE',
    'RABBITMQ_EXCHANGE',
    'RABBITMQ_EXCHANGE_TYPE',
    'RABBITMQ_DLX_EXCHANGE',
    'RABBITMQ_FAILED_QUEUE',
    'RABBITMQ_FAILED_ROUTING_KEY',
    'RABBITMQ_TRIP_COMPLETED_ROUTING_KEY',
  ];
  const tripCompletedEvent = {
    eventId: 'evt-trip-1',
    eventType: 'trip.completed',
    timestamp: '2026-10-22T14:00:00Z',
    version: '1.0',
    data: {
      tripId: 'trip-123',
      passengerId: 'passenger-1',
      passengerEmail: 'pasajero@example.com',
      driverId: 'driver-1',
      driverName: 'Ana',
      totalFare: 4500.5,
      currency: 'ARS',
      origin: 'Origen',
      destination: 'Destino',
      completedAt: '2026-10-22T13:59:00Z',
    },
  };

  let originalEnvironment: Record<string, string | undefined>;
  let connect: jest.SpyInstance;
  let messageHandler: (message: ConsumeMessage | null) => void;
  let assertExchange: jest.Mock;
  let assertQueue: jest.Mock;
  let bindQueue: jest.Mock;
  let publish: jest.Mock;
  let sendToQueue: jest.Mock;
  let waitForConfirms: jest.Mock;
  let ack: jest.Mock;
  let nack: jest.Mock;
  let closeChannel: jest.Mock;
  let closeConnection: jest.Mock;
  let send: jest.Mock;
  let markFailed: jest.Mock;
  let registerReceipt: jest.Mock;
  let consumer: TripCompletedConsumer;

  const makeMessage = (payload: unknown): ConsumeMessage =>
    ({
      content: Buffer.from(JSON.stringify(payload)),
      fields: {},
      properties: {},
    }) as ConsumeMessage;

  beforeEach(() => {
    originalEnvironment = Object.fromEntries(
      rabbitVariables.map((name) => [name, process.env[name]]),
    );
    process.env.RABBITMQ_URL = 'amqp://localhost:5672';
    process.env.RABBITMQ_QUEUE = 'notifications';
    process.env.RABBITMQ_EXCHANGE = 'mobility.events';
    process.env.RABBITMQ_EXCHANGE_TYPE = 'topic';
    process.env.RABBITMQ_DLX_EXCHANGE = 'notifications.dlx';
    process.env.RABBITMQ_FAILED_QUEUE = 'notifications.failed';
    process.env.RABBITMQ_FAILED_ROUTING_KEY = 'notifications.failed';
    process.env.RABBITMQ_TRIP_COMPLETED_ROUTING_KEY = 'trip.completed';

    assertExchange = jest.fn().mockResolvedValue(undefined);
    assertQueue = jest.fn().mockResolvedValue(undefined);
    bindQueue = jest.fn().mockResolvedValue(undefined);
    publish = jest.fn().mockReturnValue(true);
    sendToQueue = jest.fn().mockReturnValue(true);
    waitForConfirms = jest.fn().mockResolvedValue(undefined);
    ack = jest.fn();
    nack = jest.fn();
    closeChannel = jest.fn().mockResolvedValue(undefined);
    closeConnection = jest.fn().mockResolvedValue(undefined);
    const channel = {
      assertExchange,
      assertQueue,
      bindQueue,
      publish,
      sendToQueue,
      waitForConfirms,
      prefetch: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockImplementation(
        async (
          _queue: string,
          callback: (message: ConsumeMessage | null) => void,
        ) => {
          messageHandler = callback;
          return { consumerTag: 'consumer-1' };
        },
      ),
      ack,
      nack,
      close: closeChannel,
    } as unknown as Channel;
    const connection = {
      createConfirmChannel: jest.fn().mockResolvedValue(channel),
      on: jest.fn(),
      close: closeConnection,
    } as unknown as ChannelModel;
    connect = jest
      .spyOn(amqp, 'connect')
      .mockResolvedValue(connection);
    send = jest.fn().mockResolvedValue({
      success: true,
      id: 'notification-1',
      status: 'SENT',
    });
    markFailed = jest.fn().mockResolvedValue(undefined);
    registerReceipt = jest.fn().mockResolvedValue({
      receiptCode: 'REC-2026-00001',
    });
    consumer = new TripCompletedConsumer({
      send,
      markFailed,
    } as unknown as NotificationsService, {
      execute: registerReceipt,
    } as unknown as RegisterReceiptUseCase);
  });

  afterEach(async () => {
    await consumer.onModuleDestroy();
    connect.mockRestore();
    rabbitVariables.forEach((name) => {
      const value = originalEnvironment[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  });

  it('binds the durable queue to trip.completed and sends a notification for the event', async () => {
    await consumer.onModuleInit();
    const message = makeMessage(tripCompletedEvent);

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(connect).toHaveBeenCalledWith('amqp://localhost:5672');
    expect(assertExchange).toHaveBeenCalledWith('mobility.events', 'topic', {
      durable: true,
    });
    expect(assertExchange).toHaveBeenCalledWith(
      'notifications.dlx',
      'direct',
      { durable: true },
    );
    expect(assertQueue).toHaveBeenCalledWith('notifications', {
      durable: true,
    });
    expect(assertQueue).toHaveBeenCalledWith(
      'notifications.retry',
      expect.objectContaining({
        durable: true,
        arguments: {
          'x-message-ttl': 30000,
          'x-dead-letter-exchange': 'mobility.events',
          'x-dead-letter-routing-key': 'trip.completed',
        },
      }),
    );
    expect(assertQueue).toHaveBeenCalledWith('notifications.failed', {
      durable: true,
    });
    expect(bindQueue).toHaveBeenCalledWith(
      'notifications.failed',
      'notifications.dlx',
      'notifications.failed',
    );
    expect(bindQueue).toHaveBeenCalledWith(
      'notifications',
      'mobility.events',
      'trip.completed',
    );
    expect(send).toHaveBeenCalledWith(
      {
        channel: 'EMAIL',
        recipient: 'pasajero@example.com',
        subject: 'Viaje finalizado: trip-123',
        content: expect.stringContaining('Comprobante emitido: REC-2026-00001.'),
        referenceId: 'trip-123',
        referenceType: 'TRIP',
      },
      'evt-trip-1',
      false,
      true,
    );
    expect(registerReceipt).toHaveBeenCalledWith({
      tripId: 'trip-123',
      passengerId: 'passenger-1',
      passengerEmail: 'pasajero@example.com',
      amount: 4500.5,
      currency: 'ARS',
    });
    expect(registerReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    );
    expect(ack).toHaveBeenCalledWith(message);
    expect(send).toHaveBeenCalledWith(
      expect.any(Object),
      'evt-trip-1',
      false,
      true,
    );
  });

  it('creates the required durable queue and exchange by default', async () => {
    [
      'RABBITMQ_QUEUE',
      'RABBITMQ_EXCHANGE',
      'RABBITMQ_EXCHANGE_TYPE',
      'RABBITMQ_DLX_EXCHANGE',
      'RABBITMQ_FAILED_QUEUE',
      'RABBITMQ_FAILED_ROUTING_KEY',
      'RABBITMQ_TRIP_COMPLETED_ROUTING_KEY',
    ].forEach((name) => delete process.env[name]);

    await consumer.onModuleInit();

    expect(assertExchange).toHaveBeenCalledWith(
      'urban_mobility_events',
      'topic',
      { durable: true },
    );
    expect(assertQueue).toHaveBeenCalledWith('m8_notifications_queue', {
      durable: true,
    });
    expect(assertExchange).toHaveBeenCalledWith(
      'notifications.dlx',
      'direct',
      { durable: true },
    );
    expect(assertQueue).toHaveBeenCalledWith('notifications.failed', {
      durable: true,
    });
    expect(bindQueue).toHaveBeenCalledWith(
      'notifications.failed',
      'notifications.dlx',
      'notifications.failed',
    );
    [
      'trip.completed',
      'trip.assigned',
      'driver.arrived',
      'trip.cancelled',
      'reservation.created',
      'reservation.confirmed',
      'reservation.reminder',
      'payment.captured',
    ].forEach((routingKey) => {
      expect(bindQueue).toHaveBeenCalledWith(
        'm8_notifications_queue',
        'urban_mobility_events',
        routingKey,
      );
    });
  });

  it('retries trip.completed without sending email when receipt registration fails', async () => {
    registerReceipt.mockRejectedValue(new Error('Receipt storage unavailable'));
    await consumer.onModuleInit();
    const message = makeMessage(tripCompletedEvent);

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(send).not.toHaveBeenCalled();
    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications.retry',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 1,
        }),
      }),
    );
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('moves malformed events to the durable failed queue', async () => {
    await consumer.onModuleInit();
    const message = makeMessage({ eventType: 'trip.started' });

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(send).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      'notifications.dlx',
      'notifications.failed',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-failure-reason':
            'el payload no cumple un contrato canónico de viajes o reservas',
        }),
      }),
    );
    expect(ack).toHaveBeenCalledWith(message);
    expect(nack).not.toHaveBeenCalled();
  });

  it('schedules a provider failure for delayed retry', async () => {
    send.mockResolvedValue({
      success: false,
      id: 'notification-failed',
      status: 'FAILED',
      retryable: true,
    });
    await consumer.onModuleInit();
    const message = makeMessage(tripCompletedEvent);

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications.retry',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 1,
        }),
      }),
    );
    expect(waitForConfirms).toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(message);
    expect(nack).not.toHaveBeenCalled();
  });

  it('uses 30s, 60s, and 120s retries before marking the DLQ event failed', async () => {
    send.mockResolvedValue({
      success: false,
      id: 'notification-failed',
      status: 'PENDING',
      retryable: true,
    });
    await consumer.onModuleInit();
    const messages = [0, 1, 2, 3].map((retryCount) => {
      const originalMessage = makeMessage(tripCompletedEvent);
      return {
        ...originalMessage,
        fields: { ...originalMessage.fields, routingKey: 'trip.completed' },
        properties: {
          ...originalMessage.properties,
          headers: { 'x-notification-retry-count': retryCount },
        },
      } as ConsumeMessage;
    });

    for (const message of messages) {
      messageHandler(message);
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(send).toHaveBeenCalledTimes(4);
    expect(assertQueue).toHaveBeenCalledWith(
      'notifications.retry',
      expect.objectContaining({
        durable: true,
        arguments: {
          'x-message-ttl': 30000,
          'x-dead-letter-exchange': 'mobility.events',
          'x-dead-letter-routing-key': 'trip.completed',
        },
      }),
    );
    expect(assertQueue).toHaveBeenCalledWith(
      'notifications.retry.attempt-2',
      expect.objectContaining({
        arguments: expect.objectContaining({ 'x-message-ttl': 60000 }),
      }),
    );
    expect(assertQueue).toHaveBeenCalledWith(
      'notifications.retry.attempt-3',
      expect.objectContaining({
        arguments: expect.objectContaining({ 'x-message-ttl': 120000 }),
      }),
    );
    expect(sendToQueue.mock.calls.map(([queue]) => queue)).toEqual([
      'notifications.retry',
      'notifications.retry.attempt-2',
      'notifications.retry.attempt-3',
    ]);
    expect(
      sendToQueue.mock.calls.map(
        ([, , options]) => options.headers['x-notification-retry-count'],
      ),
    ).toEqual([1, 2, 3]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      'notifications.dlx',
      'notifications.failed',
      messages[3].content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 3,
          'x-failure-reason': 'proveedor de notificaciones no disponible',
        }),
      }),
    );
    expect(markFailed).toHaveBeenCalledWith(
      'evt-trip-1',
      'proveedor de notificaciones no disponible',
    );
    expect(waitForConfirms).toHaveBeenCalledTimes(4);
    expect(waitForConfirms.mock.invocationCallOrder[3]).toBeLessThan(
      markFailed.mock.invocationCallOrder[0],
    );
    expect(markFailed.mock.invocationCallOrder[0]).toBeLessThan(
      ack.mock.invocationCallOrder[3],
    );
    expect(ack).toHaveBeenCalledTimes(4);
  });

  it('processes another event while the failed event waits in its retry queue', async () => {
    send
      .mockResolvedValueOnce({
        success: false,
        id: 'notification-failed',
        status: 'FAILED',
        retryable: true,
      })
      .mockResolvedValueOnce({
        success: true,
        id: 'notification-2',
        status: 'SENT',
      });
    await consumer.onModuleInit();
    const failedMessage = makeMessage(tripCompletedEvent);
    const nextEvent = {
      ...tripCompletedEvent,
      eventId: 'evt-trip-2',
      data: { ...tripCompletedEvent.data, tripId: 'trip-456' },
    };
    const nextMessage = makeMessage(nextEvent);

    messageHandler(failedMessage);
    await new Promise((resolve) => setImmediate(resolve));
    messageHandler(nextMessage);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications.retry',
      failedMessage.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 1,
        }),
      }),
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ referenceId: 'trip-456' }),
      'evt-trip-2',
      false,
      true,
    );
    expect(ack).toHaveBeenCalledWith(failedMessage);
    expect(ack).toHaveBeenCalledWith(nextMessage);
  });

  it('doubles the delay for each subsequent retry attempt', async () => {
    send.mockResolvedValue({
      success: false,
      id: 'notification-failed',
      status: 'FAILED',
      retryable: true,
    });
    await consumer.onModuleInit();
    const originalMessage = makeMessage(tripCompletedEvent);
    const message = {
      ...originalMessage,
      fields: { ...originalMessage.fields, routingKey: 'trip.completed' },
      properties: {
        ...originalMessage.properties,
        headers: { 'x-notification-retry-count': 1 },
      },
    } as ConsumeMessage;

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(assertQueue).toHaveBeenCalledWith(
      'notifications.retry.attempt-2',
      expect.objectContaining({
        durable: true,
        arguments: {
          'x-message-ttl': 60000,
          'x-dead-letter-exchange': 'mobility.events',
          'x-dead-letter-routing-key': 'trip.completed',
        },
      }),
    );
    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications.retry.attempt-2',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 2,
        }),
      }),
    );
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('uses four times the base delay on the third retry attempt', async () => {
    send.mockResolvedValue({
      success: false,
      id: 'notification-failed',
      status: 'FAILED',
      retryable: true,
    });
    await consumer.onModuleInit();
    const originalMessage = makeMessage(tripCompletedEvent);
    const message = {
      ...originalMessage,
      fields: { ...originalMessage.fields, routingKey: 'trip.completed' },
      properties: {
        ...originalMessage.properties,
        headers: { 'x-notification-retry-count': 2 },
      },
    } as ConsumeMessage;

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(assertQueue).toHaveBeenCalledWith(
      'notifications.retry.attempt-3',
      expect.objectContaining({
        durable: true,
        arguments: {
          'x-message-ttl': 120000,
          'x-dead-letter-exchange': 'mobility.events',
          'x-dead-letter-routing-key': 'trip.completed',
        },
      }),
    );
    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications.retry.attempt-3',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 3,
        }),
      }),
    );
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('schedules database failures for delayed retry', async () => {
    send.mockRejectedValue(new Error('Database unavailable'));
    await consumer.onModuleInit();
    const message = makeMessage(tripCompletedEvent);

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications.retry',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 1,
        }),
      }),
    );
    expect(ack).toHaveBeenCalledWith(message);
    expect(nack).not.toHaveBeenCalled();
  });

  it('moves events to the failed queue after the configured retry limit', async () => {
    send.mockResolvedValue({
      success: false,
      id: 'notification-failed',
      status: 'PENDING',
      retryable: true,
    });
    await consumer.onModuleInit();
    const message = {
      ...makeMessage(tripCompletedEvent),
      properties: {
        ...makeMessage(tripCompletedEvent).properties,
        headers: { 'x-notification-retry-count': 3 },
      },
    } as ConsumeMessage;

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(publish).toHaveBeenCalledWith(
      'notifications.dlx',
      'notifications.failed',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 3,
          'x-failure-reason': 'proveedor de notificaciones no disponible',
        }),
      }),
    );
    expect(markFailed).toHaveBeenCalledWith(
      'evt-trip-1',
      'proveedor de notificaciones no disponible',
    );
    expect(waitForConfirms.mock.invocationCallOrder[0]).toBeLessThan(
      markFailed.mock.invocationCallOrder[0],
    );
    expect(ack).toHaveBeenCalledWith(message);
    expect(markFailed.mock.invocationCallOrder[0]).toBeLessThan(
      ack.mock.invocationCallOrder[0],
    );
  });

  it('binds reservation events and sends a reservation confirmation', async () => {
    await consumer.onModuleInit();
    const event = {
      eventId: 'evt-reservation-1',
      eventType: 'reservation.confirmed',
      timestamp: '2026-10-22T14:00:00Z',
      version: '1.0',
      data: {
        reservationId: 'reservation-123',
        passengerId: 'passenger-1',
        passengerEmail: 'pasajero@example.com',
        scheduledPickupTime: '2026-10-23T09:00:00Z',
        origin: 'Origen',
        destination: 'Destino',
        vehicleType: 'SEDAN',
        estimatedFare: 4500.5,
      },
    };
    const message = makeMessage(event);

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(bindQueue).toHaveBeenCalledWith(
      'notifications',
      'mobility.events',
      'reservation.confirmed',
    );
    expect(assertQueue).toHaveBeenCalledWith(
      'notifications.retry.reservation.confirmed',
      expect.objectContaining({
        durable: true,
        arguments: {
          'x-message-ttl': 30000,
          'x-dead-letter-exchange': 'mobility.events',
          'x-dead-letter-routing-key': 'reservation.confirmed',
        },
      }),
    );
    expect(send).toHaveBeenCalledWith(
      {
        channel: 'EMAIL',
        recipient: 'pasajero@example.com',
        subject: 'Reserva confirmada: reservation-123',
        content: expect.stringContaining('Origen'),
        referenceId: 'reservation-123',
        referenceType: 'RESERVATION',
      },
      'evt-reservation-1',
      false,
      true,
    );
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('maps reservation.created into the coordinated reservation notification', async () => {
    await consumer.onModuleInit();
    const message = makeMessage({
      eventId: 'evt-reservation-created',
      eventType: 'reservation.created',
      timestamp: '2026-10-22T14:00:00Z',
      version: '1.0',
      data: {
        reservationId: 'reservation-456',
        passengerId: 'passenger-2',
        passengerEmail: 'reserva@example.com',
        scheduledPickupTime: '2026-10-23T09:00:00Z',
        origin: 'Origen',
        destination: 'Destino',
        vehicleType: 'AUTO',
        estimatedFare: 3200,
      },
    });

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(bindQueue).toHaveBeenCalledWith(
      'notifications',
      'mobility.events',
      'reservation.created',
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        recipient: 'reserva@example.com',
        subject: 'Reserva creada: reservation-456',
        content: expect.stringContaining('Fecha programada:'),
        referenceId: 'reservation-456',
        referenceType: 'RESERVATION',
      }),
      'evt-reservation-created',
      false,
      true,
    );
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('maps payment.captured into the coordinated payment notification', async () => {
    await consumer.onModuleInit();
    const message = makeMessage({
      eventId: 'evt-payment-captured',
      eventType: 'payment.captured',
      timestamp: '2026-10-22T14:00:00Z',
      version: '1.0',
      data: {
        paymentId: 'payment-456',
        userId: 'passenger-3',
        userEmail: 'pago@example.com',
        amount: 1800,
        currency: 'ARS',
        paymentMethod: 'CARD',
        capturedAt: '2026-10-22T13:59:00Z',
      },
    });

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(bindQueue).toHaveBeenCalledWith(
      'notifications',
      'mobility.events',
      'payment.captured',
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        recipient: 'pago@example.com',
        subject: 'Pago capturado: payment-456',
        content: expect.stringContaining('Método de pago: CARD'),
        referenceId: 'payment-456',
        referenceType: 'PAYMENT',
      }),
      'evt-payment-captured',
      false,
      true,
    );
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('returns a failed reservation event to its matching routing key after the delay', async () => {
    send.mockResolvedValue({
      success: false,
      id: 'notification-failed',
      status: 'FAILED',
      retryable: true,
    });
    await consumer.onModuleInit();
    const message = {
      ...makeMessage({
        ...tripCompletedEvent,
        eventType: 'reservation.confirmed',
        data: {
          reservationId: 'reservation-123',
          passengerEmail: 'pasajero@example.com',
          scheduledPickupTime: '2026-10-23T09:00:00Z',
          origin: 'Origen',
          destination: 'Destino',
          vehicleType: 'SEDAN',
          estimatedFare: 4500.5,
        },
      }),
      fields: { routingKey: 'reservation.confirmed' },
    } as ConsumeMessage;

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications.retry.reservation.confirmed',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 1,
        }),
      }),
    );
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('closes the RabbitMQ channel and connection during shutdown', async () => {
    await consumer.onModuleInit();
    await consumer.onModuleDestroy();

    expect(closeChannel).toHaveBeenCalled();
    expect(closeConnection).toHaveBeenCalled();
  });
});
