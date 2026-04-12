<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Exception;

use Statly\Trade\Domain\Enum\TradeErrorCode;

final class RosterInvalidException extends TradeDomainException
{
    public function __construct()
    {
        parent::__construct(
            TradeErrorCode::TRADE_ROSTER_INVALID,
            'Trade results in an invalid roster.'
        );
    }
}
