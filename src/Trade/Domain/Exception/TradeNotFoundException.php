<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Exception;

use Statly\Trade\Domain\Enum\TradeErrorCode;

final class TradeNotFoundException extends TradeDomainException
{
    public function __construct()
    {
        parent::__construct(
            TradeErrorCode::TRADE_NOT_FOUND,
            'Trade not found.'
        );
    }
}
