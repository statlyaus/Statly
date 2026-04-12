<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Enum;

enum TradeEvent: string
{
    case TRADE_PROPOSED = 'TRADE_PROPOSED';
    case TRADE_COUNTERED = 'TRADE_COUNTERED';
    case TRADE_DECLINED = 'TRADE_DECLINED';
    case TRADE_CANCELLED = 'TRADE_CANCELLED';
    case TRADE_ACCEPTED = 'TRADE_ACCEPTED';
    case TRADE_EXECUTED = 'TRADE_EXECUTED';
    case TRADE_FAILED = 'TRADE_FAILED';
}
