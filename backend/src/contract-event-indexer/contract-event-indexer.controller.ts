import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { ContractEventIndexerService } from './contract-event-indexer.service';
import {
  IngestEventDto,
  QueryContractEventsDto,
  ReplayFromLedgerDto,
} from './dto/contract-event.dto';

@Controller('api/v1/contract-events')
export class ContractEventIndexerController {
  constructor(private readonly service: ContractEventIndexerService) {}

  /** Ingest a single contract event (called by indexer workers or webhooks) */
  @Post('ingest')
  ingest(@Body() dto: IngestEventDto) {
    return this.service.ingest(dto);
  }

  /** Ingest a batch of contract events */
  @Post('ingest/batch')
  ingestBatch(@Body() events: IngestEventDto[]) {
    return this.service.ingestBatch(events);
  }

  /** Query indexed contract events with optional filters */
  @Get()
  findAll(@Query() query: QueryContractEventsDto) {
    return this.service.findAll(query);
  }

  /** Get all events for a specific off-chain entity (order, donor, etc.) */
  @Get('entity/:ref')
  findByEntityRef(@Param('ref') ref: string) {
    return this.service.findByEntityRef(ref);
  }

  /** Get current indexer cursor positions per domain */
  @Get('cursors')
  getCursors() {
    return this.service.getCursors();
  }

  /** Replay: delete events from a ledger height and reset cursors for re-ingestion */
  @Post('replay')
  replay(@Body() dto: ReplayFromLedgerDto) {
    return this.service.replayFromLedger(dto);
  }
}
