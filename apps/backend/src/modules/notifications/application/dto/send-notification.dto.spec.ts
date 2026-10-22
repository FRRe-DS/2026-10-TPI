import { validate } from 'class-validator';
import {
  NotificationChannelDto,
  SendNotificationDto,
} from './send-notification.dto';

describe('SendNotificationDto', () => {
  const createDto = (
    overrides: Partial<SendNotificationDto> = {},
  ): SendNotificationDto =>
    Object.assign(new SendNotificationDto(), {
      channel: NotificationChannelDto.EMAIL,
      recipient: 'pasajero@ejemplo.com',
      subject: 'Tu conductor está en camino',
      content: 'El conductor llegará en 3 minutos.',
      ...overrides,
    });

  it('accepts a valid email notification', async () => {
    await expect(validate(createDto())).resolves.toHaveLength(0);
  });

  it('rejects an invalid email recipient', async () => {
    const errors = await validate(createDto({ recipient: 'no-es-un-email' }));

    expect(errors.map(({ property }) => property)).toContain('recipient');
  });

  it('does not apply email formatting to other channels', async () => {
    await expect(
      validate(
        createDto({
          channel: NotificationChannelDto.SMS,
          recipient: '+5491112345678',
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it('still requires a non-empty recipient for other channels', async () => {
    const errors = await validate(
      createDto({
        channel: NotificationChannelDto.SMS,
        recipient: '',
      }),
    );

    expect(errors.map(({ property }) => property)).toContain('recipient');
  });

  it('rejects a channel outside the supported enum', async () => {
    const errors = await validate(
      Object.assign(createDto(), { channel: 'WHATSAPP' }),
    );

    expect(errors.map(({ property }) => property)).toContain('channel');
  });
});
