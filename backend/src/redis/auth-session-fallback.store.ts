import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory fallback store for auth sessions when Redis is unavailable.
 * 
 * WARNING: This is a degraded mode fallback. Sessions stored here:
 * - Are not shared across multiple backend instances
 * - Will be lost on server restart
 * - Have limited capacity (LRU eviction)
 * 
 * Use only when Redis circuit breaker is open.
 */
@Injectable()
export class AuthSessionFallbackStore {
  private readonly logger = new Logger(AuthSessionFallbackStore.name);
  private readonly store = new Map<string, { value: string; expiresAt: number }>();
  private readonly maxSize = 10000; // Limit memory usage

  /**
   * Set a session value with TTL.
   *
   * @param key - Session key
   * @param value - Session data (JSON string)
   * @param ttlSeconds - Time to live in seconds
   */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    // Evict oldest entries if at capacity (LRU)
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
      this.logger.warn(
        `Fallback store at capacity (${this.maxSize}), evicted oldest entry`,
      );
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expiresAt });
    
    this.logger.debug(`Fallback store: set ${key} (expires in ${ttlSeconds}s)`);
  }

  /**
   * Get a session value.
   *
   * @param key - Session key
   * @returns Session data or null if not found/expired
   */
  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.logger.debug(`Fallback store: ${key} expired`);
      return null;
    }

    return entry.value;
  }

  /**
   * Delete a session.
   *
   * @param key - Session key
   */
  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.logger.debug(`Fallback store: deleted ${key}`);
  }

  /**
   * Check if a key exists and is not expired.
   *
   * @param key - Session key
   * @returns True if exists and not expired
   */
  async exists(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  /**
   * Clear all expired entries (cleanup task).
   */
  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Fallback store: cleaned ${cleaned} expired entries`);
    }

    return cleaned;
  }

  /**
   * Get current store size.
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.store.clear();
    this.logger.warn('Fallback store: cleared all entries');
  }
}
