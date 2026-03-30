import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MapsModule } from '../maps/maps.module';
import { PolicyCenterModule } from '../policy-center/policy-center.module';
import { RidersModule } from '../riders/riders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';

import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { RiderAssignmentService } from './rider-assignment.service';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    TypeOrmModule.forFeature([BloodUnit, OrderEntity]),
    RidersModule,
    MapsModule,
    PolicyCenterModule,
    NotificationsModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchService, RiderAssignmentService],
  exports: [DispatchService, RiderAssignmentService],
})
export class DispatchModule {}
