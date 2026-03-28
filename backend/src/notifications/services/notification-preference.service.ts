import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotificationPreference,
  NotificationChannel,
  NotificationCategory,
  EmergencyTier,
} from '../entities/notification-preference.entity';
import {
  NotificationDeliveryLog,
  DeliveryStatus,
} from '../entities/notification-delivery-log.entity';

@Injectable()
export class NotificationPreferenceService {
  constructor(
    @InjectRepository(NotificationPreference)
    private preferenceRepo: Repository<NotificationPreference>,
    @InjectRepository(NotificationDeliveryLog)
    private deliveryLogRepo: Repository<NotificationDeliveryLog>,
  ) {}

  async getUserPreferences(userId: string): Promise<NotificationPreference[]> {
    return this.preferenceRepo.find({
      where: { userId },
    });
  }

  async getOrganizationPreferences(
    organizationId: string,
  ): Promise<NotificationPreference[]> {
    return this.preferenceRepo.find({
      where: { organizationId },
    });
  }

  async setPreference(
    userId: string,
    category: NotificationCategory,
    channels: NotificationChannel[],
    quietHoursEnabled: boolean = false,
    quietHoursStart?: string,
    quietHoursEnd?: string,
    emergencyBypassTier: EmergencyTier = EmergencyTier.NORMAL,
  ): Promise<NotificationPreference> {
    let preference = await this.preferenceRepo.findOne({
      where: { userId, category },
    });

    if (preference) {
      preference.channels = channels;
      preference.quietHoursEnabled = quietHoursEnabled;
      preference.quietHoursStart = quietHoursStart;
      preference.quietHoursEnd = quietHoursEnd;
      preference.emergencyBypassTier = emergencyBypassTier;
    } else {
      preference = this.preferenceRepo.create({
        userId,
        category,
        channels,
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
        emergencyBypassTier,
      });
    }

    return this.preferenceRepo.save(preference);
  }

  async shouldSendNotification(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
    emergencyTier: EmergencyTier = EmergencyTier.NORMAL,
  ): Promise<{ shouldSend: boolean; reason?: string; emergencyBypass: boolean }> {
    const preference = await this.preferenceRepo.findOne({
      where: { userId, category },
    });

    if (!preference || !preference.enabled) {
      return {
        shouldSend: false,
        reason: 'Category disabled or no preference set',
        emergencyBypass: false,
      };
    }

    if (!preference.channels.includes(channel)) {
      return {
        shouldSend: false,
        reason: 'Channel not enabled for this category',
        emergencyBypass: false,
      };
    }

    // Check quiet hours
    if (preference.quietHoursEnabled && this.isInQuietHours(preference)) {
      // Check emergency bypass
      if (this.shouldBypassQuietHours(emergencyTier, preference.emergencyBypassTier)) {
        return {
          shouldSend: true,
          reason: 'Emergency bypass of quiet hours',
          emergencyBypass: true,
        };
      }

      return {
        shouldSend: false,
        reason: 'Within quiet hours',
        emergencyBypass: false,
      };
    }

    return { shouldSend: true, emergencyBypass: false };
  }

  private isInQuietHours(preference: NotificationPreference): boolean {
    if (!preference.quietHoursStart || !preference.quietHoursEnd) {
      return false;
    }

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const start = preference.quietHoursStart;
    const end = preference.quietHoursEnd;

    // Handle overnight quiet hours (e.g., 22:00 to 06:00)
    if (start > end) {
      return currentTime >= start || currentTime <= end;
    }

    return currentTime >= start && currentTime <= end;
  }

  private shouldBypassQuietHours(
    eventTier: EmergencyTier,
    bypassTier: EmergencyTier,
  ): boolean {
    const tierPriority = {
      [EmergencyTier.NORMAL]: 0,
      [EmergencyTier.URGENT]: 1,
      [EmergencyTier.CRITICAL]: 2,
    };

    return tierPriority[eventTier] >= tierPriority[bypassTier];
  }

  async logDelivery(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
    status: DeliveryStatus,
    reason?: string,
    emergencyBypass: boolean = false,
    metadata?: Record<string, any>,
  ): Promise<NotificationDeliveryLog> {
    const log = this.deliveryLogRepo.create({
      userId,
      category,
      channel,
      status,
      reason,
      emergencyBypass,
      metadata,
    });

    return this.deliveryLogRepo.save(log);
  }

  async getDeliveryLogs(
    userId: string,
    limit: number = 50,
  ): Promise<NotificationDeliveryLog[]> {
    return this.deliveryLogRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
