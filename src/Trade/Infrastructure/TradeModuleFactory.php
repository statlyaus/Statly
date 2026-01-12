<?php

declare(strict_types=1);

namespace Statly\Trade\Infrastructure;

use PDO;
use Statly\Trade\Application\TradeService;
use Statly\Trade\Domain\Contract\LockoutServiceInterface;
use Statly\Trade\Domain\Contract\SquadServiceInterface;
use Statly\Trade\Domain\Contract\TradeAuditServiceInterface;
use Statly\Trade\Domain\Contract\TradeServiceInterface;
use Statly\Trade\Domain\TradeValidator;
use Statly\Trade\Infrastructure\Repository\DbTradeActionRepository;
use Statly\Trade\Infrastructure\Repository\DbTradeItemRepository;
use Statly\Trade\Infrastructure\Repository\DbTradePlayerLockRepository;
use Statly\Trade\Infrastructure\Repository\DbTradeRepository;
use Statly\Trade\Infrastructure\Transaction\PdoTransactionManager;

final class TradeModuleFactory
{
    public static function create(
        PDO $connection,
        TradeAuditServiceInterface $auditService,
        LockoutServiceInterface $lockoutService,
        SquadServiceInterface $squadService
    ): TradeServiceInterface {
        $transactionManager = new PdoTransactionManager($connection);
        $tradeRepository = new DbTradeRepository($connection);
        $tradeItemRepository = new DbTradeItemRepository($connection);
        $tradePlayerLockRepository = new DbTradePlayerLockRepository($connection);
        $tradeActionRepository = new DbTradeActionRepository($connection);
        $tradeValidator = new TradeValidator();

        return new TradeService(
            $transactionManager,
            $tradeRepository,
            $tradeItemRepository,
            $tradePlayerLockRepository,
            $tradeActionRepository,
            $auditService,
            $tradeValidator,
            $lockoutService,
            $squadService
        );
    }
}
