import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
import { UserEntity } from '../users/entities/user.entity';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { DisputeEntity } from '../disputes/entities/dispute.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      BloodUnit,
      OrderEntity,
      DisputeEntity,
      OrganizationEntity,
      BloodRequestEntity,
    ]),
  ],
  controllers: [ReportingController],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
