<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Enum;

enum TradeStatus: string
{
    case PROPOSED = 'PROPOSED';
    case DECLINED = 'DECLINED';
    case CANCELLED = 'CANCELLED';
    case SUPERSEDED = 'SUPERSEDED';
    case EXPIRED = 'EXPIRED';
    case EXECUTED = 'EXECUTED';
}
