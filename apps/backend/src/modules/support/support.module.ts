import { Module } from '@nestjs/common';
import { SupportController } from './infrastructure/controllers/support.controller';
import { SupportService } from './application/support.service';
import { PrismaService } from '../../common/prisma.service';

@Module({
  controllers: [SupportController],
  providers: [SupportService, PrismaService],
  exports: [SupportService],
})
export class SupportModule { }
