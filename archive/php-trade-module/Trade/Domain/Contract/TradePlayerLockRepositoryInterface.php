<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Contract;

interface TradePlayerLockRepositoryInterface
{
    /**
     * @param list<string> $playerIds
     */
    public function ensureLocks(string $tradeId, array $playerIds): void;

    /**
     * @param list<string> $playerIds
     * @return array<string, string> playerId => tradeId
     */
    public function getLocks(array $playerIds): array;

    /**
     * @param list<string> $playerIds
     */
    public function transferLocks(string $fromTradeId, string $toTradeId, array $playerIds): void;

    /**
     * @param list<string> $playerIds
     */
    public function releaseLocksForPlayers(string $tradeId, array $playerIds): void;

    public function releaseLocks(string $tradeId): void;
}
