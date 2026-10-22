import { ConsumeMessage, Channel, ChannelModel } from 'amqplib';
import * as amqp from 'amqplib';
import { NotificationsService } from '../../application/notifications.service';
import { TripCompletedConsumer } from './trip-completed.consumer';

describe('TripCompletedConsumer', () => {
  const rabbitVariables = [
    'RABBITMQ_URL',
    'RABBITMQ_QUEUE',
    'RABBITMQ_EXCHANGE',
    'RABBITMQ_EXCHANGE_TYPE',
    'RABBITMQ_TRIP_COMPLETED_ROUTING_KEY',
    'RABBITMQ_NOTIFICATION_MAX_RETRIES',
    'RABBITMQ_NOTIFICATION_RETRY_DELAY_MS',
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
  let sendToQueue: jest.Mock;
  let waitForConfirms: jest.Mock;
  let ack: jest.Mock;
  let nack: jest.Mock;
  let closeChannel: jest.Mock;
  let closeConnection: jest.Mock;
  let send: jest.Mock;
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
    process.env.RABBITMQ_TRIP_COMPLETED_ROUTING_KEY = 'trip.completed';

    assertExchange = jest.fn().mockResolvedValue(undefined);
    assertQueue = jest.fn().mockResolvedValue(undefined);
    bindQueue = jest.fn().mockResolvedValue(undefined);
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
    consumer = new TripCompletedConsumer({
      send,
    } as unknown as NotificationsService);
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
      'notifications',
      'mobility.events',
      'trip.completed',
    );
    expect(send).toHaveBeenCalledWith(
      {
        channel: 'EMAIL',
        recipient: 'pasajero@example.com',
        subject: 'Viaje finalizado: trip-123',
        content: expect.stringContaining('Total abonado:'),
        referenceId: 'trip-123',
        referenceType: 'TRIP',
      },
      'evt-trip-1',
      false,
    );
    expect(ack).toHaveBeenCalledWith(message);
    expect(send).toHaveBeenCalledWith(
      expect.any(Object),
      'evt-trip-1',
      false,
    );
  });

  it('moves malformed events to the durable failed queue', async () => {
    await consumer.onModuleInit();
    const message = makeMessage({ eventType: 'trip.started' });

    messageHandler(message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(send).not.toHaveBeenCalled();
    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications.failed',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-failure-reason':
            'el payload no cumple el contrato trip.completed',
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
      status: 'FAILED',
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

    expect(sendToQueue).toHaveBeenCalledWith(
      'notifications.failed',
      message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-notification-retry-count': 3,
          'x-failure-reason': 'proveedor de notificaciones no disponible',
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
