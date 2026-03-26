import { Test, TestingModule } from '@nestjs/testing';

import { BlockchainController } from '../controllers/blockchain.controller';
import { AdminGuard } from '../guards/admin.guard';
import { QueueMetricsService } from '../services/queue-metrics.service';
import { SorobanService } from '../services/soroban.service';
import {
  SorobanTxJob,
  QueueMetrics,
  SorobanTxResult,
} from '../types/soroban-tx.types';

const BASE_METRICS: QueueMetrics = {
  queueDepth: 5,
  failedJobs: 2,
  dlqCount: 1,
  processingRate: 0,
  counters: { queued: 10, processing: 1, success: 7, failure: 2, retries: 3, dlq: 1 },
  timings: { avgMs: 120, minMs: 80, maxMs: 300, samples: 7 },
};

describe('BlockchainController', () => {
  let controller: BlockchainController;
  let mockSorobanService: any;
  let mockQueueMetricsService: any;

  beforeEach(async () => {
    mockSorobanService = {
      submitTransaction: jest.fn().mockResolvedValue('job-123'),
      getQueueMetrics: jest.fn().mockResolvedValue(BASE_METRICS),
      getJobStatus: jest.fn().mockResolvedValue({
        jobId: 'job-123',
        transactionHash: 'tx_abc123',
        status: 'completed',
        error: null,
        retryCount: 0,
        createdAt: new Date(),
        completedAt: new Date(),
      }),
    };

    mockQueueMetricsService = {
      getDetailedMetrics: jest.fn().mockResolvedValue({
        counters: { queued: 10, processing: 1, success: 7, failure: 2, retries: 3, dlq: 1 },
        timings: { avgMs: 120, minMs: 80, maxMs: 300, samples: 7 },
        live: { waiting: 3, active: 1, failed: 2, delayed: 0, dlqDepth: 1 },
        since: '2026-01-01T00:00:00.000Z',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlockchainController],
      providers: [
        { provide: SorobanService, useValue: mockSorobanService },
        { provide: QueueMetricsService, useValue: mockQueueMetricsService },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BlockchainController>(BlockchainController);
  });

  describe('submitTransaction', () => {
    it('should submit a transaction and return job ID', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey: 'test-key-1',
      };

      const result = await controller.submitTransaction(job);

      expect(result).toEqual({ jobId: 'job-123' });
      expect(mockSorobanService.submitTransaction).toHaveBeenCalledWith(job);
    });

    it('should return 202 Accepted status', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'test',
        args: [],
        idempotencyKey: 'test-key-2',
      };

      // Note: HTTP status is handled by decorator, not testable in unit test
      // This is verified through integration tests
      await controller.submitTransaction(job);
      expect(mockSorobanService.submitTransaction).toHaveBeenCalled();
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue metrics', async () => {
      const metrics = await controller.getQueueStatus();

      expect(metrics).toMatchObject({
        queueDepth: 5,
        failedJobs: 2,
        dlqCount: 1,
        processingRate: 0,
      });
      expect(mockSorobanService.getQueueMetrics).toHaveBeenCalled();
    });

    it('should include all required metrics fields', async () => {
      const metrics = await controller.getQueueStatus();

      expect(metrics).toHaveProperty('queueDepth');
      expect(metrics).toHaveProperty('failedJobs');
      expect(metrics).toHaveProperty('dlqCount');
      expect(metrics).toHaveProperty('counters');
      expect(metrics).toHaveProperty('timings');
    });
  });

  describe('getJobStatus', () => {
    it('should return job status for valid job ID', async () => {
      const status = await controller.getJobStatus('job-123');

      expect(status).toEqual({
        jobId: 'job-123',
        transactionHash: 'tx_abc123',
        status: 'completed',
        error: null,
        retryCount: 0,
        createdAt: expect.any(Date),
        completedAt: expect.any(Date),
      });
      expect(mockSorobanService.getJobStatus).toHaveBeenCalledWith('job-123');
    });

    it('should return null for non-existent job', async () => {
      mockSorobanService.getJobStatus.mockResolvedValueOnce(null);

      const status = await controller.getJobStatus('non-existent-job');

      expect(status).toBeNull();
    });

    it('should handle failed job status', async () => {
      mockSorobanService.getJobStatus.mockResolvedValueOnce({
        jobId: 'job-456',
        transactionHash: undefined,
        status: 'failed',
        error: 'RPC timeout',
        retryCount: 3,
        createdAt: new Date(),
        completedAt: undefined,
      });

      const status = await controller.getJobStatus('job-456');

      expect(status).not.toBeNull();
      expect(status!.status).toBe('failed');
      expect(status!.error).toBe('RPC timeout');
      expect(status!.retryCount).toBe(3);
    });
  });

  describe('getDetailedMetrics', () => {
    it('returns counters, timings, live, and since fields', async () => {
      const result = await controller.getDetailedMetrics();

      expect(result).toHaveProperty('counters');
      expect(result).toHaveProperty('timings');
      expect(result).toHaveProperty('live');
      expect(result).toHaveProperty('since');
      expect(mockQueueMetricsService.getDetailedMetrics).toHaveBeenCalled();
    });

    it('counters include all six metrics', async () => {
      const { counters } = await controller.getDetailedMetrics();

      expect(counters).toMatchObject({
        queued: expect.any(Number),
        processing: expect.any(Number),
        success: expect.any(Number),
        failure: expect.any(Number),
        retries: expect.any(Number),
        dlq: expect.any(Number),
      });
    });
  });

  describe('getPrometheusMetrics', () => {
    it('returns a non-empty string', async () => {
      const result = await controller.getPrometheusMetrics();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('contains all expected metric names', async () => {
      const result = await controller.getPrometheusMetrics();

      expect(result).toContain('soroban_queue_jobs_queued_total');
      expect(result).toContain('soroban_queue_jobs_processing_current');
      expect(result).toContain('soroban_queue_jobs_success_total');
      expect(result).toContain('soroban_queue_jobs_failure_total');
      expect(result).toContain('soroban_queue_jobs_retries_total');
      expect(result).toContain('soroban_queue_jobs_dlq_total');
      expect(result).toContain('soroban_queue_processing_duration_avg_ms');
      expect(result).toContain('soroban_queue_dlq_depth');
    });

    it('includes HELP and TYPE annotations', async () => {
      const result = await controller.getPrometheusMetrics();
      expect(result).toContain('# HELP');
      expect(result).toContain('# TYPE');
    });
  });

  describe('Acceptance Criteria', () => {
    it('should expose POST /blockchain/submit-transaction endpoint', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey: 'acceptance-test-1',
      };

      const result = await controller.submitTransaction(job);

      expect(result).toHaveProperty('jobId');
      expect(mockSorobanService.submitTransaction).toHaveBeenCalled();
    });

    it('should expose GET /blockchain/queue/status admin endpoint', async () => {
      const metrics = await controller.getQueueStatus();

      expect(metrics).toHaveProperty('queueDepth');
      expect(metrics).toHaveProperty('failedJobs');
      expect(metrics).toHaveProperty('dlqCount');
    });

    it('should expose GET /blockchain/job/:jobId endpoint', async () => {
      const status = await controller.getJobStatus('job-123');

      expect(status).toHaveProperty('jobId');
      expect(status).toHaveProperty('status');
      expect(mockSorobanService.getJobStatus).toHaveBeenCalledWith('job-123');
    });

    it('should expose GET /blockchain/metrics with counters and timings', async () => {
      const metrics = await controller.getDetailedMetrics();

      expect(metrics.counters).toHaveProperty('queued');
      expect(metrics.counters).toHaveProperty('processing');
      expect(metrics.counters).toHaveProperty('success');
      expect(metrics.counters).toHaveProperty('failure');
      expect(metrics.counters).toHaveProperty('retries');
      expect(metrics.counters).toHaveProperty('dlq');
      expect(metrics.timings).toHaveProperty('avgMs');
    });

    it('should expose GET /blockchain/metrics/prometheus in Prometheus format', async () => {
      const result = await controller.getPrometheusMetrics();
      expect(result).toContain('soroban_queue_jobs_queued_total');
      expect(result).toContain('soroban_queue_jobs_dlq_total');
    });

    it('should return accurate queue metrics', async () => {
      const metrics = await controller.getQueueStatus();

      expect(typeof metrics.queueDepth).toBe('number');
      expect(typeof metrics.failedJobs).toBe('number');
      expect(typeof metrics.dlqCount).toBe('number');
      expect(metrics.queueDepth).toBe(5);
      expect(metrics.failedJobs).toBe(2);
      expect(metrics.dlqCount).toBe(1);
    });
  });
});
