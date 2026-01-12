<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Contract;

use Statly\Trade\Domain\Enum\TradeErrorCode;
use Statly\Trade\Domain\Enum\TradeEvent;

interface TradeAuditServiceInterface
{
    /**
     * @param array<string, mixed> $payload
     */
    public function record(
        string $tradeId,
        TradeEvent $event,
        string $actorUserId,
        array $payload,
        ?TradeErrorCode $errorCode = null
    ): void;
}
