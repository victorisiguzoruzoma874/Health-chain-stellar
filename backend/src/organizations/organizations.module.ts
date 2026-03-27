import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { OrganizationEntity } from './entities/organization.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationRepository } from './organizations.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrganizationEntity]),
    BlockchainModule,
    NotificationsModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationRepository],
  exports: [OrganizationsService, OrganizationRepository],
})
export class OrganizationsModule {}
