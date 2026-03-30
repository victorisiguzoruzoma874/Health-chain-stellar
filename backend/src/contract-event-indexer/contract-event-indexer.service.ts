import { createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { PaginatedResponse, PaginationUtil } from '../common/pagination';

import {
  IngestEventDto,
  QueryContractEventsDto,
  ReplayFromLedgerDto,
} from './dto/contract-event.dto';
import {
  ContractDomain,
  ContractEventEntity,
} from './entities/contract-event.entity';
import { IndexerCursorEntity } from './entities/indexer-cursor.entity';

export interface ReplayResult {
  domain: ContractDomain | 'all';
  fromLedger: number;
  deletedCount: number;
  message: string;
}

@Injectable()
export class ContractEventIndexerService {
  private readonly logger = new Logger(ContractEventIndexerService.name);

  constructor(
    @InjectRepository(ContractEventEntity)
    private readonly eventRepo: Repository<ContractEventEntity>,
    @InjectRepository(IndexerCursorEntity)
    private readonly cursorRepo: Repository<IndexerCursorEntity>,
  ) {}

  // ── Ingestion ────────────────────────────────────────────────────────

  /**
   * Ingest a single contract event. Idempotent — duplicate dedup keys are silently skipped.
   */
  async ingest(dto: IngestEventDto): Promise<ContractEventEntity | null> {
    const dedupKey = this.buildDedupKey(dto);

    const existing = await this.eventRepo.findOne({ where: { dedupKey } });
    if (existing) {
      this.logger.debug(`Skipping duplicate event dedupKey=${dedupKey}`);
      return null;
    }

    const event = this.eventRepo.create({
      domain: dto.domain,
      eventType: dto.eventType,
      ledgerSequence: dto.ledgerSequence,
      txHash: dto.txHash ?? null,
      contractRef: dto.contractRef ?? null,
      payload: dto.payload,
      entityRef: dto.entityRef ?? null,
      dedupKey,
    });

    const saved = await this.eventRepo.save(event);
    await this.advanceCursor(dto.domain, dto.ledgerSequence);
    this.logger.log(
      `Indexed event ${dto.domain}.${dto.eventType} ledger=${dto.ledgerSequence}`,
    );
    return saved;
  }

  /**
   * Bulk ingest — processes each event individually for dedup safety.
   * Returns count of newly persisted events.
   */
  async ingestBatch(events: IngestEventDto[]): Promise<number> {
    let count = 0;
    for (const dto of events) {
      const result = await this.ingest(dto);
      if (result) count++;
    }
    return count;
  }

  // ── Query ────────────────────────────────────────────────────────────

  async findAll(
    query: QueryContractEventsDto,
  ): Promise<PaginatedResponse<ContractEventEntity>> {
    const { page = 1, pageSize = 25 } = query;

    const qb = this.eventRepo
      .createQueryBuilder('e')
      .orderBy('e.ledger_sequence', 'DESC')
      .addOrderBy('e.indexed_at', 'DESC');

    if (query.domain)
      qb.andWhere('e.domain = :domain', { domain: query.domain });
    if (query.eventType)
      qb.andWhere('e.event_type = :eventType', { eventType: query.eventType });
    if (query.entityRef)
      qb.andWhere('e.entity_ref = :entityRef', { entityRef: query.entityRef });

    qb.skip(PaginationUtil.calculateSkip(page, pageSize)).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return PaginationUtil.createResponse(data, page, pageSize, total);
  }

  async findByEntityRef(entityRef: string): Promise<ContractEventEntity[]> {
    return this.eventRepo.find({
      where: { entityRef },
      order: { ledgerSequence: 'ASC' },
    });
  }

  async getCursors(): Promise<IndexerCursorEntity[]> {
    return this.cursorRepo.find({ order: { domain: 'ASC' } });
  }

  // ── Replay ───────────────────────────────────────────────────────────

  /**
   * Delete all indexed events at or after fromLedger (optionally scoped to a domain)
   * and reset the cursor so the indexer will re-ingest from that point.
   */
  async replayFromLedger(dto: ReplayFromLedgerDto): Promise<ReplayResult> {
    const qb = this.eventRepo
      .createQueryBuilder()
      .delete()
      .from(ContractEventEntity)
      .where('ledger_sequence >= :from', { from: dto.fromLedger });

    if (dto.domain) {
      qb.andWhere('domain = :domain', { domain: dto.domain });
    }

    const result = await qb.execute();
    const deletedCount = (result.affected as number | undefined) ?? 0;

    // Reset cursor(s)
    if (dto.domain) {
      await this.cursorRepo.update(
        { domain: dto.domain },
        { lastLedger: Math.max(0, dto.fromLedger - 1) },
      );
    } else {
      await this.cursorRepo
        .createQueryBuilder()
        .update()
        .set({ lastLedger: Math.max(0, dto.fromLedger - 1) })
        .where('last_ledger >= :from', { from: dto.fromLedger })
        .execute();
    }

    this.logger.log(
      `Replay initiated: deleted ${deletedCount} events from ledger ${dto.fromLedger}` +
        (dto.domain ? ` (domain=${dto.domain})` : ''),
    );

    return {
      domain: dto.domain ?? 'all',
      fromLedger: dto.fromLedger,
      deletedCount,
      message: `Deleted ${deletedCount} events. Cursors reset to ledger ${dto.fromLedger - 1}. Re-ingest to rebuild.`,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private buildDedupKey(dto: IngestEventDto): string {
    const raw = `${dto.domain}:${dto.eventType}:${dto.txHash ?? ''}:${dto.ledgerSequence}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 64);
  }

  private async advanceCursor(
    domain: ContractDomain,
    ledger: number,
  ): Promise<void> {
    const cursor = await this.cursorRepo.findOne({ where: { domain } });
    if (!cursor) {
      await this.cursorRepo.save(
        this.cursorRepo.create({ domain, lastLedger: ledger }),
      );
    } else if (ledger > cursor.lastLedger) {
      cursor.lastLedger = ledger;
      await this.cursorRepo.save(cursor);
    }
  }
}
