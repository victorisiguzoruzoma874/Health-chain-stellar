import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  UseGuards,
  Param,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { NotificationPreferenceService } from '../services/notification-preference.service';
import {
  NotificationChannel,
  NotificationCategory,
  EmergencyTier,
} from '../entities/notification-preference.entity';

class SetPreferenceDto {
  category: NotificationCategory;
  channels: NotificationChannel[];
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  emergencyBypassTier?: EmergencyTier;
}

@Controller('api/v1/notification-preferences')
@UseGuards(JwtAuthGuard)
export class NotificationPreferenceController {
  constructor(
    private readonly preferenceService: NotificationPreferenceService,
  ) {}

  @Get()
  async getMyPreferences(@CurrentUser() user: any) {
    return this.preferenceService.getUserPreferences(user.id);
  }

  @Post()
  async setPreference(
    @Body() dto: SetPreferenceDto,
    @CurrentUser() user: any,
  ) {
    return this.preferenceService.setPreference(
      user.id,
      dto.category,
      dto.channels,
      dto.quietHoursEnabled,
      dto.quietHoursStart,
      dto.quietHoursEnd,
      dto.emergencyBypassTier,
    );
  }

  @Get('delivery-logs')
  async getMyDeliveryLogs(@CurrentUser() user: any) {
    return this.preferenceService.getDeliveryLogs(user.id);
  }

  @Get('delivery-logs/:userId')
  async getUserDeliveryLogs(@Param('userId') userId: string) {
    return this.preferenceService.getDeliveryLogs(userId);
  }
}
