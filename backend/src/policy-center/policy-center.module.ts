import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PolicyVersionEntity } from './entities/policy-version.entity';
import { PolicyCenterController } from './policy-center.controller';
import { PolicyCenterService } from './policy-center.service';
import { PolicyReplayService } from './policy-replay.service';

@Module({
  imports: [TypeOrmModule.forFeature([PolicyVersionEntity])],
  controllers: [PolicyCenterController],
  providers: [PolicyCenterService, PolicyReplayService],
  exports: [PolicyCenterService, PolicyReplayService],
})
export class PolicyCenterModule {}
