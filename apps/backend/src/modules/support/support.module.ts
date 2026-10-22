import { Module } from '@nestjs/common';
import { SupportController } from './infrastructure/controllers/support.controller';
import { SupportService } from './application/support.service';
import { SUPPORT_TICKET_REPOSITORY_PORT } from './domain/ports/support-ticket.repository.port';
import { PrismaSupportTicketRepository } from './infrastructure/persistence/prisma-support-ticket.repository';
import { PrismaService } from '../../common/prisma.service';

@Module({
  controllers: [SupportController],
  providers: [
    SupportService,
    PrismaService,
    // --- Puerto de persistencia de tickets ---
    {
      provide: SUPPORT_TICKET_REPOSITORY_PORT,
      useClass: PrismaSupportTicketRepository,
    },
  ],
  exports: [SupportService],
})
export class SupportModule { }
