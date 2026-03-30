import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  OrderCancelledEvent,
  OrderStatusUpdatedEvent,
  OrderRiderAssignedEvent,
} from '../events';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { BloodStatus } from '../blood-units/enums/blood-status.enum';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationChannel } from '../notifications/enums/notification-channel.enum';
import type { ColdChainBreachEvent } from '../cold-chain/cold-chain.service';

import { RiderAssignmentService } from './rider-assignment.service';

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);
  private readonly processedEvents = new Set<string>(); // For idempotency

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly riderAssignmentService: RiderAssignmentService,
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepo: Repository<BloodUnit>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Generate a unique key for event idempotency
   */
  private getEventKey(
    eventName: string,
    orderId: string,
    timestamp: Date,
  ): string {
    return `${eventName}:${orderId}:${timestamp.getTime()}`;
  }

  /**
   * Check if event has already been processed (idempotency check)
   */
  private isEventProcessed(eventKey: string): boolean {
    return this.processedEvents.has(eventKey);
  }

  /**
   * Mark event as processed
   */
  private markEventProcessed(eventKey: string): void {
    this.processedEvents.add(eventKey);
    // Clean up old entries after 1 hour to prevent memory leak
    const cleanupTimer = setTimeout(
      () => this.processedEvents.delete(eventKey),
      3600000,
    );
    cleanupTimer.unref?.();
  }

  @OnEvent('order.cancelled')
  async handleOrderCancelled(event: OrderCancelledEvent) {
    const eventKey = this.getEventKey(
      'order.cancelled',
      event.orderId,
      event.timestamp,
    );

    if (this.isEventProcessed(eventKey)) {
      this.logger.warn(`Duplicate event detected: ${eventKey}`);
      return;
    }

    this.logger.log(`Handling order cancelled: ${event.orderId}`);

    // TODO: Implement dispatch cancellation logic
    const result = {
      orderId: event.orderId,
      status: 'cancelled',
      reason: event.reason,
      cancelledAt: new Date(),
    };

    this.markEventProcessed(eventKey);

    this.logger.log(`Dispatch cancelled for order ${event.orderId}`);
    return result;
  }

  @OnEvent('order.status.updated')
  async handleOrderStatusUpdated(event: OrderStatusUpdatedEvent) {
    const eventKey = this.getEventKey(
      'order.status.updated',
      event.orderId,
      event.timestamp,
    );

    if (this.isEventProcessed(eventKey)) {
      this.logger.warn(`Duplicate event detected: ${eventKey}`);
      return;
    }

    this.logger.log(
      `Handling order status update: ${event.orderId} from ${event.previousStatus} to ${event.newStatus}`,
    );

    // TODO: Implement dispatch status update logic based on order status
    const result = {
      orderId: event.orderId,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      updatedAt: new Date(),
    };

    this.markEventProcessed(eventKey);

    this.logger.log(`Dispatch status updated for order ${event.orderId}`);
    return result;
  }

  @OnEvent('order.rider.assigned')
  async handleOrderRiderAssigned(event: OrderRiderAssignedEvent) {
    const eventKey = this.getEventKey(
      'order.rider.assigned',
      event.orderId,
      event.timestamp,
    );

    if (this.isEventProcessed(eventKey)) {
      this.logger.warn(`Duplicate event detected: ${eventKey}`);
      return;
    }

    this.logger.log(
      `Handling rider assignment: ${event.riderId} to order ${event.orderId}`,
    );

    // TODO: Implement dispatch rider assignment logic
    const result = {
      orderId: event.orderId,
      riderId: event.riderId,
      status: 'assigned',
      assignedAt: new Date(),
    };

    this.markEventProcessed(eventKey);

    this.logger.log(
      `Rider ${event.riderId} assigned to dispatch for order ${event.orderId}`,
    );
    return result;
  }

  @OnEvent('cold-chain.breach')
  async handleColdChainBreach(event: ColdChainBreachEvent): Promise<void> {
    this.logger.warn(
      `Cold-chain breach detected for delivery ${event.deliveryId}: ` +
        `${event.breachDurationMinutes.toFixed(1)} min outside 2–8 °C`,
    );

    // 1. Mark the order SUSPENDED
    if (event.orderId) {
      await this.orderRepo.update(event.orderId, {
        status: OrderStatus.CANCELLED, // closest available status; extend enum if needed
      });
    }

    // 2. Mark the blood unit COMPROMISED (map to QUARANTINED)
    if (event.orderId) {
      const order = await this.orderRepo.findOne({ where: { id: event.orderId } });
      if (order) {
        await this.bloodUnitRepo
          .createQueryBuilder()
          .update()
          .set({ status: BloodStatus.QUARANTINED })
          .where('reservedFor = :orderId', { orderId: event.orderId })
          .execute();
      }
    }

    // 3. Re-assign to a backup rider
    try {
      await this.riderAssignmentService.reassign(event.orderId ?? event.deliveryId);
    } catch (err) {
      this.logger.error(`Rider reassignment failed for delivery ${event.deliveryId}: ${(err as Error).message}`);
    }

    // 4. Notify hospital and blood bank
    if (event.orderId) {
      const order = await this.orderRepo.findOne({ where: { id: event.orderId } });
      if (order) {
        const notifyIds = [order.hospitalId, order.bloodBankId].filter(Boolean) as string[];
        for (const recipientId of notifyIds) {
          await this.notificationsService.send({
            recipientId,
            channels: [NotificationChannel.EMAIL],
            templateKey: 'cold_chain_breach',
            variables: {
              deliveryId: event.deliveryId,
              orderId: event.orderId ?? '',
              breachDurationMinutes: String(event.breachDurationMinutes.toFixed(1)),
              minTempCelsius: String(event.minTempCelsius),
              maxTempCelsius: String(event.maxTempCelsius),
              breachStartedAt: event.breachStartedAt.toISOString(),
            },
          }).catch((e) =>
            this.logger.warn(`Breach notification failed for ${recipientId}: ${(e as Error).message}`),
          );
        }
      }
    }
  }

  async findAll(): Promise<{ message: string; data: unknown[] }> {
    return {
      message: 'Dispatches retrieved successfully',
      data: (await this.riderAssignmentService.getAssignmentLogs()).data,
    };
  }

  async findOne(id: string) {
    // TODO: Implement find dispatch by id logic
    return {
      message: 'Dispatch retrieved successfully',
      data: { id },
    };
  }

  async create(createDispatchDto: any) {
    // TODO: Implement create dispatch logic
    return {
      message: 'Dispatch created successfully',
      data: createDispatchDto,
    };
  }

  async update(id: string, updateDispatchDto: any) {
    // TODO: Implement update dispatch logic
    return {
      message: 'Dispatch updated successfully',
      data: { id, ...updateDispatchDto },
    };
  }

  async remove(id: string) {
    // TODO: Implement delete dispatch logic
    return {
      message: 'Dispatch deleted successfully',
      data: { id },
    };
  }

  async assignOrder(orderId: string, riderId: string) {
    this.eventEmitter.emit(
      'order.rider.assigned',
      new OrderRiderAssignedEvent(orderId, riderId),
    );
    return {
      message: 'Order assigned to rider successfully',
      data: { orderId, riderId },
    };
  }

  async completeDispatch(dispatchId: string) {
    // TODO: Implement complete dispatch logic
    return {
      message: 'Dispatch completed successfully',
      data: { id: dispatchId, status: 'completed' },
    };
  }

  async cancelDispatch(dispatchId: string, reason: string) {
    // TODO: Implement cancel dispatch logic
    return {
      message: 'Dispatch cancelled successfully',
      data: { id: dispatchId, status: 'cancelled', reason },
    };
  }

  getDispatchStats(): {
    message: string;
    data: {
      total: number;
      pending: number;
      accepted: number;
      escalated: number;
      timeout: number;
      rejected: number;
    };
  } {
    return this.riderAssignmentService.getDispatchStats();
  }

  async getAssignmentLogs(
    orderId?: string,
  ): Promise<{ message: string; data: unknown[] }> {
    return this.riderAssignmentService.getAssignmentLogs(orderId);
  }

  async respondToAssignment(
    orderId: string,
    riderId: string,
    accepted: boolean,
  ) {
    return this.riderAssignmentService.respondToAssignment(
      orderId,
      riderId,
      accepted,
    );
  }
}
