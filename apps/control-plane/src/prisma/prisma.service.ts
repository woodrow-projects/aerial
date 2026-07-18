import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
    // SQLite tuning (ADR D11, amended): WAL lets reads proceed during a write;
    // busy_timeout waits out short lock contention instead of failing with
    // SQLITE_BUSY; synchronous=NORMAL is the recommended pairing with WAL.
    await this.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await this.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
    await this.$queryRawUnsafe("PRAGMA synchronous=NORMAL;");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
