import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import {
  DevAuthController,
  DevTokenProviderService,
  JwtAuthGuard,
  JwtAuthService,
  RolesGuard,
} from './auth';

@Global()
@Module({
  controllers: [DevAuthController],
  providers: [
    PrismaService,
    RedisService,
    DevTokenProviderService,
    JwtAuthService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    PrismaService,
    RedisService,
    DevTokenProviderService,
    JwtAuthService,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class CommonModule {}
