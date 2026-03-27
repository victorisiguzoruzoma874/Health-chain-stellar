import { Injectable, Logger } from '@nestjs/common';

/**
 * Circuit breaker for Redis operations.
 * Provides graceful degradation when Redis is unavailable.
 *
 * States:
 * - CLOSED: Normal operation, all requests go through
 * - OPEN: Redis is down, all requests use fallback
 * - HALF_OPEN: Testing if Redis recovered
 */
@Injectable()
export class RedisCircuitBreaker {
  private readonly logger = new Logger(RedisCircuitBreaker.name);
  private isOpen = false;
  private failureCount = 0;
  private lastFailureTime: number | null = null;

  private readonly failureThreshold = 5;
  private readonly resetTimeoutMs = 30_000; // 30 seconds

  /**
   * Execute Redis operation with circuit breaker protection.
   *
   * @param operation - Redis operation to execute
   * @param fallback - Fallback function when Redis is unavailable
   * @returns Result from operation or fallback
   */
  async execute<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T> | T,
  ): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.isOpen) {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime > this.resetTimeoutMs
      ) {
        this.logger.log('Circuit breaker: attempting to reset (HALF_OPEN)');
        this.isOpen = false;
        this.failureCount = 0;
        this.lastFailureTime = null;
      } else {
        this.logger.warn('Circuit breaker: OPEN, using fallback');
        return fallback();
      }
    }

    try {
      const result = await operation();
      
      // Success - reset failure count
      if (this.failureCount > 0) {
        this.logger.log('Circuit breaker: operation succeeded, resetting to CLOSED');
        this.failureCount = 0;
        this.lastFailureTime = null;
      }
      
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      this.logger.error(
        `Circuit breaker: operation failed (${this.failureCount}/${this.failureThreshold}): ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      // Open circuit if threshold reached
      if (this.failureCount >= this.failureThreshold) {
        this.isOpen = true;
        this.logger.error('Circuit breaker: opening circuit - Redis unavailable');
      }

      return fallback();
    }
  }

  /**
   * Check if circuit is currently open.
   */
  isCircuitOpen(): boolean {
    return this.isOpen;
  }

  /**
   * Get current failure count.
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Manually reset circuit breaker (for testing/admin operations).
   */
  reset(): void {
    this.isOpen = false;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.logger.log('Circuit breaker: manually reset');
  }
}
