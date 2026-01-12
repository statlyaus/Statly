<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Contract;

interface TradeActionRepositoryInterface
{
    /**
     * Returns false when the action is already recorded (idempotent replay).
     */
    public function recordAction(
        string $tradeId,
        string $action,
        string $requestId,
        string $actorUserId
    ): bool;
}
