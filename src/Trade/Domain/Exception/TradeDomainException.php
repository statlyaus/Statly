<?php

declare(strict_types=1);

namespace Statly\Trade\Domain\Exception;

use RuntimeException;
use Statly\Trade\Domain\Enum\TradeErrorCode;

abstract class TradeDomainException extends RuntimeException
{
    public function __construct(
        public readonly TradeErrorCode $errorCode,
        string $message
    ) {
        parent::__construct($message);
    }
}
