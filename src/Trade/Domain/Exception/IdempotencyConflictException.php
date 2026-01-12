<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Exception;

use Statly\Trade\Domain\Enum\TradeErrorCode;

final class IdempotencyConflictException extends TradeDomainException
{
    public function __construct()
    {
        parent::__construct(
            TradeErrorCode::TRADE_IDEMPOTENCY_CONFLICT,
            'Duplicate request detected.'
        );
    }
}
