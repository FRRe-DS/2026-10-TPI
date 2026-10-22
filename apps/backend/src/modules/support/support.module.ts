import { Module } from '@nestjs/common';
import { SupportController } from './infrastructure/controllers/support.controller';
import { SupportService } from './application/support.service';

@Module({
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
