<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Contract;

interface SquadServiceInterface
{
    /**
     * @return array<string, mixed>
     */
    public function getRosterSnapshot(string $leagueId, string $userId): array;

    public function applyTrade(string $tradeId): void;
}
