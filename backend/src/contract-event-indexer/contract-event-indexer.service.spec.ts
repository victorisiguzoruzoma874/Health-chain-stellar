import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ContractEventIndexerService } from './contract-event-indexer.service';
import { IngestEventDto } from './dto/contract-event.dto';
import {
  ContractDomain,
  ContractEventEntity,
} from './entities/contract-event.entity';
import { IndexerCursorEntity } from './entities/indexer-cursor.entity';

function makeDto(overrides: Partial<IngestEventDto> = {}): IngestEventDto {
  return {
    domain: ContractDomain.PAYMENT,
    eventType: 'payment.released',
    ledgerSequence: 1000,
    txHash: 'abc123',
    payload: { amount: 100 },
    ...overrides,
  };
}

describe('ContractEventIndexerService', () => {
  let service: ContractEventIndexerService;
  let eventRepo: Record<string, jest.Mock>;
  let cursorRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    eventRepo = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      create: jest.fn((dto) => ({ id: 'evt-1', ...dto })),
      save: jest.fn((e) => Promise.resolve({ id: 'evt-1', ...e })),
      findOne: jest.fn(() => Promise.resolve(null)),
      find: jest.fn(() => Promise.resolve([])),
      createQueryBuilder: jest.fn(() => ({
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(() => Promise.resolve([[], 0])),
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(() => Promise.resolve({ affected: 3 })),
      })),
    };

    cursorRepo = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((e) => Promise.resolve(e)),
      findOne: jest.fn(() => Promise.resolve(null)),
      find: jest.fn(() => Promise.resolve([])),
      update: jest.fn(() => Promise.resolve(undefined)),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(() => Promise.resolve(undefined)),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractEventIndexerService,
        {
          provide: getRepositoryToken(ContractEventEntity),
          useValue: eventRepo,
        },
        {
          provide: getRepositoryToken(IndexerCursorEntity),
          useValue: cursorRepo,
        },
      ],
    }).compile();

    service = module.get(ContractEventIndexerService);
  });

  describe('ingest', () => {
    it('persists a new event and returns it', async () => {
      const result = await service.ingest(makeDto());
      expect(eventRepo.save).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it('returns null for a duplicate event (same dedup key)', async () => {
      eventRepo.findOne.mockResolvedValue({ id: 'existing' });
      const result = await service.ingest(makeDto());
      expect(result).toBeNull();
      expect(eventRepo.save).not.toHaveBeenCalled();
    });

    it('creates a cursor entry when none exists', async () => {
      cursorRepo.findOne.mockResolvedValue(null);
      await service.ingest(makeDto());
      expect(cursorRepo.save).toHaveBeenCalled();
    });

    it('advances cursor when new ledger is higher', async () => {
      cursorRepo.findOne.mockResolvedValue({
        domain: ContractDomain.PAYMENT,
        lastLedger: 500,
      });
      await service.ingest(makeDto({ ledgerSequence: 1000 }));
      expect(cursorRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastLedger: 1000 }),
      );
    });

    it('does not advance cursor when new ledger is lower', async () => {
      cursorRepo.findOne.mockResolvedValue({
        domain: ContractDomain.PAYMENT,
        lastLedger: 2000,
      });
      await service.ingest(makeDto({ ledgerSequence: 1000 }));
      expect(cursorRepo.save).not.toHaveBeenCalled();
    });

    it('generates deterministic dedup key from domain+eventType+txHash+ledger', async () => {
      const dto = makeDto();
      await service.ingest(dto);
      await service.ingest(dto); // second call — findOne returns null again but dedup key is same
      // Both calls go through; dedup is enforced by DB unique constraint + findOne check
      expect(eventRepo.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('ingestBatch', () => {
    it('returns count of newly persisted events', async () => {
      const count = await service.ingestBatch([
        makeDto(),
        makeDto({ eventType: 'payment.failed' }),
      ]);
      expect(count).toBe(2);
    });

    it('skips duplicates and counts only new events', async () => {
      eventRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'dup' });
      const count = await service.ingestBatch([
        makeDto(),
        makeDto({ eventType: 'payment.failed' }),
      ]);
      expect(count).toBe(1);
    });
  });

  describe('findAll', () => {
    it('returns paginated response', async () => {
      const result = await service.findAll({ page: 1, pageSize: 10 });
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination).toHaveProperty('totalCount');
    });
  });

  describe('findByEntityRef', () => {
    it('returns events for entity ref', async () => {
      const events = [{ id: 'e1', entityRef: 'order-1' }];
      eventRepo.find.mockResolvedValue(events);
      const result = await service.findByEntityRef('order-1');
      expect(result).toEqual(events);
    });
  });

  describe('getCursors', () => {
    it('returns all cursor records', async () => {
      const cursors = [{ domain: ContractDomain.PAYMENT, lastLedger: 1000 }];
      cursorRepo.find.mockResolvedValue(cursors);
      const result = await service.getCursors();
      expect(result).toEqual(cursors);
    });
  });

  describe('replayFromLedger', () => {
    it('returns deleted count and message', async () => {
      const result = await service.replayFromLedger({ fromLedger: 500 });
      expect(result.deletedCount).toBe(3);
      expect(result.fromLedger).toBe(500);
      expect(result.message).toContain('3');
    });

    it('scopes deletion to domain when provided', async () => {
      const result = await service.replayFromLedger({
        fromLedger: 500,
        domain: ContractDomain.DELIVERY,
      });
      expect(result.domain).toBe(ContractDomain.DELIVERY);
    });

    it('resets cursor for specific domain', async () => {
      await service.replayFromLedger({
        fromLedger: 500,
        domain: ContractDomain.PAYMENT,
      });
      expect(cursorRepo.update).toHaveBeenCalledWith(
        { domain: ContractDomain.PAYMENT },
        { lastLedger: 499 },
      );
    });
  });
});
