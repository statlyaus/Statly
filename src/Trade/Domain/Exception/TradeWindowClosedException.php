<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Exception;

use Statly\Trade\Domain\Enum\TradeErrorCode;

final class TradeWindowClosedException extends TradeDomainException
{
    public function __construct()
    {
        parent::__construct(
            TradeErrorCode::TRADE_WINDOW_CLOSED,
            'Trading is closed for this round.'
        );
    }
}
