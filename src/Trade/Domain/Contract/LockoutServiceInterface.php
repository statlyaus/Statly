<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Contract;

interface LockoutServiceInterface
{
    public function assertTradeWindowOpen(string $leagueId, ?string $roundId): void;
}
