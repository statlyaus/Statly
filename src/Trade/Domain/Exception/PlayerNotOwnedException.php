<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Exception;

use Statly\Trade\Domain\Enum\TradeErrorCode;

final class PlayerNotOwnedException extends TradeDomainException
{
    public function __construct()
    {
        parent::__construct(
            TradeErrorCode::TRADE_PLAYER_NOT_OWNED,
            'One or more players are not on the sender roster.'
        );
    }
}
