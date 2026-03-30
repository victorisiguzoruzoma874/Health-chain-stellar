import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Tracks the highest ledger sequence successfully indexed per domain. */
@Entity('contract_indexer_cursors')
export class IndexerCursorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'domain', type: 'varchar', length: 50, unique: true })
  domain: string;

  @Column({ name: 'last_ledger', type: 'bigint', default: 0 })
  lastLedger: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
